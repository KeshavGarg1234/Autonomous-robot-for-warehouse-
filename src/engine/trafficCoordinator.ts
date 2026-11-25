import {
  GridCoord,
  ReservationEntry,
  Robot,
  SmoothingMode,
  WaitEdge,
  WarehouseLayout,
} from './types';
import { planSpaceTimePath, smoothTrajectory } from './pathPlanner';
import {
  coordKey,
  getPassageForCell,
  isCellWalkableAtTick,
} from './warehouseManager';

export interface ProposedMove {
  robotId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  isWait: boolean;
  priorityScore: number;
  nextStepIndex: number;
}

export interface CoordinationOutcome {
  approvedMoves: Map<string, ProposedMove>;
  waitEdges: WaitEdge[];
  reservations: ReservationEntry[];
  passageEvents: {
    type: 'AISLE_RESERVED' | 'AISLE_RELEASED';
    robotId: string;
    passageId: string;
    passageName: string;
  }[];
  deadlocksDetected: {
    cycleRobotIds: string[];
    yieldedRobotId: string;
    sidesteppedTo: GridCoord | null;
  }[];
  replannedRobotIds: string[];
}

const LOOKAHEAD_TICKS = 14;

/**
 * Computes dynamic anti-starvation priority for conflict resolution.
 */
function computeDynamicPriority(robot: Robot): number {
  let score = robot.priority * 10;
  if (robot.carryingPackageId) score += 25; // Carrying cargo gets priority
  if (robot.status === 'RECOVERING_PACKAGE') score += 20;
  score += Math.min(40, robot.waitTicks * 4); // Starvation prevention aging
  return score;
}

/**
 * Builds the global space-time reservation table from robots' planned schedules.
 */
export function buildReservationTable(
  robots: Robot[],
  currentTick: number,
  lookahead = LOOKAHEAD_TICKS
): ReservationEntry[] {
  const entries: ReservationEntry[] = [];

  for (const r of robots) {
    if (r.status === 'FAILED') {
      // Failed robot permanently reserves its cell for the lookahead window
      for (let dt = 0; dt <= lookahead; dt++) {
        entries.push({
          robotId: r.id,
          x: r.x,
          y: r.y,
          tick: currentTick + dt,
          kind: 'CELL',
        });
      }
      continue;
    }

    if (!r.path || r.path.rawSteps.length === 0) {
      // Idle robot reserves its current cell for full lookahead so Space-Time A* never assumes it vanishes
      for (let dt = 0; dt <= lookahead; dt++) {
        entries.push({
          robotId: r.id,
          x: r.x,
          y: r.y,
          tick: currentTick + dt,
          kind: 'CELL',
        });
      }
      continue;
    }

    const steps = r.path.rawSteps;
    const startIdx = Math.min(r.pathStepIndex, steps.length - 1);
    const maxIdx = Math.min(steps.length - 1, startIdx + lookahead);

    for (let idx = startIdx; idx <= maxIdx; idx++) {
      const s = steps[idx];
      const dt = idx - startIdx;
      const absTick = currentTick + dt;
      entries.push({
        robotId: r.id,
        x: s.x,
        y: s.y,
        tick: absTick,
        kind: 'CELL',
      });

      if (idx > startIdx) {
        const prev = steps[idx - 1];
        if (prev.x !== s.x || prev.y !== s.y) {
          entries.push({
            robotId: r.id,
            x: s.x,
            y: s.y,
            fromX: prev.x,
            fromY: prev.y,
            tick: absTick,
            kind: 'EDGE',
          });
        }
      }
    }
  }

  return entries;
}

/**
 * Detects directed cycles in the Wait-for Graph using DFS.
 */
function findWaitCycles(edges: WaitEdge[]): string[][] {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.waitingRobotId)) adj.set(e.waitingRobotId, []);
    adj.get(e.waitingRobotId)!.push(e.blockingRobotId);
  }

  const cycles: string[][] = [];
  const state = new Map<string, number>(); // 0=unvisited, 1=visiting, 2=visited
  const stack: string[] = [];

  const dfs = (u: string) => {
    state.set(u, 1);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      const vState = state.get(v) ?? 0;
      if (vState === 1) {
        const idx = stack.indexOf(v);
        if (idx !== -1) {
          cycles.push(stack.slice(idx));
        }
      } else if (vState === 0) {
        dfs(v);
      }
    }
    stack.pop();
    state.set(u, 2);
  };

  for (const node of adj.keys()) {
    if ((state.get(node) ?? 0) === 0) {
      dfs(node);
    }
  }

  return cycles;
}

/**
 * Finds an open adjacent cell (alcove/sidestep) that is not occupied or blocked,
 * used to break head-on deadlocks in narrow corridors.
 */
function findSidestepCell(
  warehouse: WarehouseLayout,
  robot: Robot,
  occupiedKeys: Set<string>,
  avoidKey: string,
  atTick: number
): GridCoord | null {
  const dirs = [
    { x: 0, y: -1 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
  ];
  // Prefer cells outside narrow aisles first (alcoves!)
  const candidates: { coord: GridCoord; score: number }[] = [];
  for (const d of dirs) {
    const nx = robot.x + d.x;
    const ny = robot.y + d.y;
    const key = coordKey(nx, ny);
    if (!isCellWalkableAtTick(warehouse, nx, ny, atTick)) continue;
    if (occupiedKeys.has(key)) continue;
    if (key === avoidKey) continue;
    const isNarrow = warehouse.grid[ny][nx] === 'NARROW_AISLE';
    candidates.push({
      coord: { x: nx, y: ny },
      score: isNarrow ? 2 : 0,
    });
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.coord ?? null;
}

/**
 * Centralized Fleet Coordination Cycle:
 *  1. Collect proposed next cells from each active robot's trajectory
 *  2. Enforce Narrow Passage Locks
 *  3. Simultaneously validate all proposed moves (no vertex collisions, no edge swaps, no obstacle entry)
 *  4. Build Wait-for Graph & detect + resolve deadlocks
 *  5. Commit non-conflicting movements atomically
 */
export function coordinateFleetTick(
  robots: Robot[],
  warehouse: WarehouseLayout,
  currentTick: number,
  smoothingMode: SmoothingMode,
  smoothingTension: number,
  getGoalForRobot: (r: Robot) => GridCoord | null
): CoordinationOutcome {
  const passageEvents: CoordinationOutcome['passageEvents'] = [];
  const deadlocksDetected: CoordinationOutcome['deadlocksDetected'] = [];
  const replannedRobotIds: string[] = [];

  const robotById = new Map(robots.map((r) => [r.id, r]));
  const currentOccupancy = new Map<string, string>();
  const failedCells = new Set<string>();

  for (const r of robots) {
    currentOccupancy.set(coordKey(r.x, r.y), r.id);
    if (r.status === 'FAILED') {
      failedCells.add(coordKey(r.x, r.y));
    }
  }

  // Step 1: Release narrow passage locks if the holding robot left the passage or failed
  for (const passage of warehouse.passages) {
    if (passage.lockedByRobotId) {
      const holder = robotById.get(passage.lockedByRobotId);
      const stillInside =
        holder &&
        holder.status !== 'FAILED' &&
        passage.cells.some((c) => c.x === holder.x && c.y === holder.y);

      // Keep lock if holder is about to enter on next step (within 2 ticks of lock acquisition)
      const aboutToEnter =
        holder &&
        holder.status !== 'FAILED' &&
        holder.path &&
        holder.pathStepIndex + 1 < holder.path.rawSteps.length &&
        passage.cells.some((c) => {
          const nextStep = holder.path!.rawSteps[holder.pathStepIndex + 1];
          return c.x === nextStep.x && c.y === nextStep.y;
        });

      if (!stillInside && !aboutToEnter) {
        passageEvents.push({
          type: 'AISLE_RELEASED',
          robotId: passage.lockedByRobotId,
          passageId: passage.id,
          passageName: passage.name,
        });
        passage.lockedByRobotId = null;
        passage.lockedDirection = 0;
      }
    }
  }

  // Step 2: Gather raw proposed moves for every robot
  const proposals = new Map<string, ProposedMove>();
  for (const r of robots) {
    if (r.status === 'FAILED' || r.status === 'IDLE' || !r.path) {
      proposals.set(r.id, {
        robotId: r.id,
        fromX: r.x,
        fromY: r.y,
        toX: r.x,
        toY: r.y,
        isWait: true,
        priorityScore: computeDynamicPriority(r),
        nextStepIndex: r.pathStepIndex,
      });
      continue;
    }

    const steps = r.path.rawSteps;
    const nextIdx = r.pathStepIndex + 1;
    if (nextIdx >= steps.length) {
      proposals.set(r.id, {
        robotId: r.id,
        fromX: r.x,
        fromY: r.y,
        toX: r.x,
        toY: r.y,
        isWait: true,
        priorityScore: computeDynamicPriority(r),
        nextStepIndex: r.pathStepIndex,
      });
      continue;
    }

    const nextStep = steps[nextIdx];
    const isWait = nextStep.x === r.x && nextStep.y === r.y;

    // Validate time-dependent walkability for currentTick + 1 (catches active & newly scheduled blocks!)
    if (!isCellWalkableAtTick(warehouse, nextStep.x, nextStep.y, currentTick + 1)) {
      proposals.set(r.id, {
        robotId: r.id,
        fromX: r.x,
        fromY: r.y,
        toX: r.x,
        toY: r.y,
        isWait: true,
        priorityScore: computeDynamicPriority(r),
        nextStepIndex: r.pathStepIndex,
      });
      continue;
    }

    proposals.set(r.id, {
      robotId: r.id,
      fromX: r.x,
      fromY: r.y,
      toX: nextStep.x,
      toY: nextStep.y,
      isWait,
      priorityScore: computeDynamicPriority(r),
      nextStepIndex: nextIdx,
    });
  }

  // Step 3: Narrow passage access gating
  // Sort active proposers by priority descending so highest-priority robot gets passage lock first
  const sortedProposers = [...proposals.values()].sort(
    (a, b) => b.priorityScore - a.priorityScore
  );

  for (const prop of sortedProposers) {
    if (prop.isWait) continue;
    const passageInfo = getPassageForCell(warehouse, prop.toX, prop.toY);
    if (!passageInfo) continue;

    const { passage, cellIndex } = passageInfo;
    const fromInPassage = getPassageForCell(warehouse, prop.fromX, prop.fromY);
    const samePassage = fromInPassage?.passage.id === passage.id;

    if (passage.lockedByRobotId === null) {
      passage.lockedByRobotId = prop.robotId;
      passage.lockAcquiredTick = currentTick;
      passage.lockedDirection =
        cellIndex === 0 ? 1 : cellIndex === passage.cells.length - 1 ? -1 : 1;
      passageEvents.push({
        type: 'AISLE_RESERVED',
        robotId: prop.robotId,
        passageId: passage.id,
        passageName: passage.name,
      });
    } else if (passage.lockedByRobotId !== prop.robotId && !samePassage) {
      // Another robot holds the narrow passage — hold this robot outside until released!
      prop.toX = prop.fromX;
      prop.toY = prop.fromY;
      prop.isWait = true;
      prop.nextStepIndex = robotById.get(prop.robotId)!.pathStepIndex;
    }
  }

  // Step 4: Simultaneous conflict resolution (Iterative fixed-point validation)
  // Ensures no two robots land on the same cell, no head-on swaps, and no moving into a stationary/held cell.
  let changed = true;
  let guard = 0;
  while (changed && guard < 20) {
    changed = false;
    guard++;

    // 4a. Check head-on swaps (A->B and B->A)
    for (const a of sortedProposers) {
      if (a.isWait) continue;
      for (const b of sortedProposers) {
        if (a.robotId === b.robotId || b.isWait) continue;
        if (
          a.toX === b.fromX &&
          a.toY === b.fromY &&
          b.toX === a.fromX &&
          b.toY === a.fromY
        ) {
          // Hold lower-priority robot
          const loser = a.priorityScore >= b.priorityScore ? b : a;
          loser.toX = loser.fromX;
          loser.toY = loser.fromY;
          loser.isWait = true;
          loser.nextStepIndex = robotById.get(loser.robotId)!.pathStepIndex;
          changed = true;
        }
      }
    }

    // 4b. Check vertex collisions (two robots targeting same cell)
    const targetClaims = new Map<string, ProposedMove[]>();
    for (const p of sortedProposers) {
      const key = coordKey(p.toX, p.toY);
      if (!targetClaims.has(key)) targetClaims.set(key, []);
      targetClaims.get(key)!.push(p);
    }

    for (const [, claimers] of targetClaims) {
      if (claimers.length <= 1) continue;
      // If one robot is already waiting in its own cell, it automatically keeps its own cell!
      const alreadyHere = claimers.find((c) => c.isWait);
      const winner =
        alreadyHere ??
        claimers.reduce((best, cur) =>
          cur.priorityScore > best.priorityScore ? cur : best
        );
      for (const c of claimers) {
        if (c.robotId !== winner.robotId && !c.isWait) {
          c.toX = c.fromX;
          c.toY = c.fromY;
          c.isWait = true;
          c.nextStepIndex = robotById.get(c.robotId)!.pathStepIndex;
          changed = true;
        }
      }
    }

    // 4c. Check if target cell is currently occupied by a robot that is NOT vacating it
    const vacatingMap = new Map<string, boolean>();
    for (const p of sortedProposers) {
      vacatingMap.set(coordKey(p.fromX, p.fromY), !p.isWait);
    }
    for (const p of sortedProposers) {
      if (p.isWait) continue;
      const destKey = coordKey(p.toX, p.toY);
      const occupantId = currentOccupancy.get(destKey);
      if (occupantId && occupantId !== p.robotId) {
        const occupantProp = proposals.get(occupantId);
        if (!occupantProp || occupantProp.isWait) {
          p.toX = p.fromX;
          p.toY = p.fromY;
          p.isWait = true;
          p.nextStepIndex = robotById.get(p.robotId)!.pathStepIndex;
          changed = true;
        }
      }
    }
  }

  // Step 5: Build Wait-for Graph based on desired next path cell vs current occupant
  const rawWaitEdges: WaitEdge[] = [];
  for (const r of robots) {
    const prop = proposals.get(r.id);
    if (!prop || !prop.isWait || r.status === 'FAILED' || r.status === 'IDLE') {
      continue;
    }
    if (!r.path || r.pathStepIndex + 1 >= r.path.rawSteps.length) continue;
    const desired = r.path.rawSteps[r.pathStepIndex + 1];
    if (desired.x === r.x && desired.y === r.y) continue;

    const blockerId = currentOccupancy.get(coordKey(desired.x, desired.y));
    if (blockerId && blockerId !== r.id) {
      rawWaitEdges.push({
        waitingRobotId: r.id,
        blockingRobotId: blockerId,
        targetCell: { x: desired.x, y: desired.y },
        inCycle: false,
      });
    } else {
      // Check if blocked by a narrow passage holder
      const pInfo = getPassageForCell(warehouse, desired.x, desired.y);
      if (
        pInfo?.passage.lockedByRobotId &&
        pInfo.passage.lockedByRobotId !== r.id
      ) {
        rawWaitEdges.push({
          waitingRobotId: r.id,
          blockingRobotId: pInfo.passage.lockedByRobotId,
          targetCell: { x: desired.x, y: desired.y },
          inCycle: false,
        });
      }
    }
  }

  const cycles = findWaitCycles(rawWaitEdges);
  const cycleNodes = new Set<string>();
  for (const c of cycles) {
    for (const id of c) cycleNodes.add(id);
  }
  for (const edge of rawWaitEdges) {
    if (
      cycleNodes.has(edge.waitingRobotId) &&
      cycleNodes.has(edge.blockingRobotId)
    ) {
      edge.inCycle = true;
    }
  }

  // Step 6: Deadlock Resolution (cycles, idle blockers, and prolonged wait)
  const reservations = buildReservationTable(robots, currentTick);
  const occupiedKeys = new Set<string>(currentOccupancy.keys());

  for (const cycle of cycles) {
    if (cycle.length < 2) continue;
    // Prefer yielding the robot that HAS an open sidestep cell; break ties by lowest dynamic priority
    const rankedCandidates = cycle
      .map((id) => robotById.get(id)!)
      .filter((r) => r && r.status !== 'FAILED')
      .map((r) => {
        const desiredStep =
          r.path && r.pathStepIndex + 1 < r.path.rawSteps.length
            ? r.path.rawSteps[r.pathStepIndex + 1]
            : { x: r.x, y: r.y };
        const sidestep = findSidestepCell(
          warehouse,
          r,
          occupiedKeys,
          coordKey(desiredStep.x, desiredStep.y),
          currentTick + 1
        );
        return { robot: r, sidestep };
      })
      .sort((a, b) => {
        const aHas = a.sidestep ? 0 : 1;
        const bHas = b.sidestep ? 0 : 1;
        if (aHas !== bHas) return aHas - bHas;
        return (
          computeDynamicPriority(a.robot) - computeDynamicPriority(b.robot)
        );
      });

    const chosen = rankedCandidates[0];
    if (!chosen) continue;
    const yielder = chosen.robot;
    const sidestep = chosen.sidestep;

    // Release passage lock if yielder holds one
    for (const passage of warehouse.passages) {
      if (passage.lockedByRobotId === yielder.id) {
        passage.lockedByRobotId = null;
        passage.lockedDirection = 0;
      }
    }

    const goal = getGoalForRobot(yielder);
    if (sidestep && goal) {
      // Reserve yielder's vacated cell for the OTHER cycle members so they advance cleanly through it
      const temporaryReservations = [
        ...reservations,
        {
          robotId: '__PASS_RIGHT__',
          x: yielder.x,
          y: yielder.y,
          tick: currentTick + 1,
          kind: 'CELL' as const,
        },
        {
          robotId: '__PASS_RIGHT__',
          x: yielder.x,
          y: yielder.y,
          tick: currentTick + 2,
          kind: 'CELL' as const,
        },
      ];

      // Force immediate sidestep move this tick + 2 hold ticks in alcove to prevent oscillation
      const yieldProp = proposals.get(yielder.id)!;
      yieldProp.toX = sidestep.x;
      yieldProp.toY = sidestep.y;
      yieldProp.isWait = false;
      occupiedKeys.add(coordKey(sidestep.x, sidestep.y));

      const afterSidestep = planSpaceTimePath({
        robotId: yielder.id,
        warehouse,
        start: sidestep,
        goal,
        startTick: currentTick + 3,
        reservations: temporaryReservations,
        failedRobotCells: failedCells,
        smoothingMode,
        smoothingTension,
      });

      if (afterSidestep) {
        const combinedRaw = [
          { x: yielder.x, y: yielder.y, tick: currentTick },
          { x: sidestep.x, y: sidestep.y, tick: currentTick + 1 },
          { x: sidestep.x, y: sidestep.y, tick: currentTick + 2 },
          ...afterSidestep.rawSteps,
        ];
        yielder.path = smoothTrajectory(
          combinedRaw,
          warehouse,
          smoothingMode,
          smoothingTension
        );
        yielder.pathStepIndex = 0;
        yieldProp.nextStepIndex = 1;
        yielder.lastReplanTick = currentTick;
        replannedRobotIds.push(yielder.id);
      }
    } else if (goal) {
      const replan = planSpaceTimePath({
        robotId: yielder.id,
        warehouse,
        start: { x: yielder.x, y: yielder.y },
        goal,
        startTick: currentTick,
        reservations,
        failedRobotCells: failedCells,
        occupiedOtherRobotCells: new Set(
          robots
            .filter((o) => o.id !== yielder.id)
            .map((o) => coordKey(o.x, o.y))
        ),
        smoothingMode,
        smoothingTension,
      });
      if (replan) {
        yielder.path = replan;
        yielder.pathStepIndex = 0;
        yielder.lastReplanTick = currentTick;
        replannedRobotIds.push(yielder.id);
      }
    }

    deadlocksDetected.push({
      cycleRobotIds: cycle,
      yieldedRobotId: yielder.id,
      sidesteppedTo: sidestep,
    });
  }

  // Step 6b: Evacuate IDLE robots that are blocking an active robot
  for (const edge of rawWaitEdges) {
    if (edge.inCycle) continue;
    const blocker = robotById.get(edge.blockingRobotId);
    const waiter = robotById.get(edge.waitingRobotId);
    if (!blocker || !waiter || blocker.status !== 'IDLE') continue;

    const blockerProp = proposals.get(blocker.id);
    if (!blockerProp || !blockerProp.isWait) continue;

    const evacCell = findSidestepCell(
      warehouse,
      blocker,
      occupiedKeys,
      coordKey(waiter.x, waiter.y),
      currentTick + 1
    );
    if (evacCell) {
      blockerProp.toX = evacCell.x;
      blockerProp.toY = evacCell.y;
      blockerProp.isWait = false;
      occupiedKeys.add(coordKey(evacCell.x, evacCell.y));
      deadlocksDetected.push({
        cycleRobotIds: [waiter.id, blocker.id],
        yieldedRobotId: blocker.id,
        sidesteppedTo: evacCell,
      });
    }
  }

  // Also check prolonged waiting (>= 3 ticks) where a robot is stuck behind another robot or obstacle
  for (const r of robots) {
    const prop = proposals.get(r.id);
    if (
      prop &&
      prop.isWait &&
      r.status !== 'FAILED' &&
      r.status !== 'IDLE' &&
      r.waitTicks >= 3 &&
      r.waitTicks % 3 === 0 &&
      currentTick - r.lastReplanTick >= 2
    ) {
      const goal = getGoalForRobot(r);
      if (goal) {
        const occupiedOthers = new Set(
          robots.filter((o) => o.id !== r.id).map((o) => coordKey(o.x, o.y))
        );
        const replan = planSpaceTimePath({
          robotId: r.id,
          warehouse,
          start: { x: r.x, y: r.y },
          goal,
          startTick: currentTick,
          reservations,
          failedRobotCells: failedCells,
          occupiedOtherRobotCells: occupiedOthers,
          smoothingMode,
          smoothingTension,
        });
        if (replan) {
          r.path = replan;
          r.pathStepIndex = 0;
          r.lastReplanTick = currentTick;
          replannedRobotIds.push(r.id);
        }
      }
    }
  }

  return {
    approvedMoves: proposals,
    waitEdges: rawWaitEdges,
    reservations,
    passageEvents,
    deadlocksDetected,
    replannedRobotIds,
  };
}
