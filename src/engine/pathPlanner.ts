import {
  GridCoord,
  Point2D,
  ReservationEntry,
  SmoothedTrajectory,
  SmoothingMode,
  SpaceTimeStep,
  SplinePoint,
  WarehouseLayout,
} from './types';
import {
  coordKey,
  getPassageForCell,
  isCellWalkable,
  isCellWalkableAtTick,
  manhattan,
} from './warehouseManager';

const DIRS: GridCoord[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

interface MinHeapNode<T> {
  priority: number;
  value: T;
}

class MinHeap<T> {
  private items: MinHeapNode<T>[] = [];

  get size(): number {
    return this.items.length;
  }

  push(value: T, priority: number): void {
    this.items.push({ value, priority });
    this.bubbleUp(this.items.length - 1);
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0].value;
    const end = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = end;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(idx: number): void {
    const node = this.items[idx];
    while (idx > 0) {
      const parentIdx = (idx - 1) >> 1;
      const parent = this.items[parentIdx];
      if (node.priority >= parent.priority) break;
      this.items[idx] = parent;
      this.items[parentIdx] = node;
      idx = parentIdx;
    }
  }

  private sinkDown(idx: number): void {
    const len = this.items.length;
    const node = this.items[idx];
    while (true) {
      let swapIdx = -1;
      const leftIdx = (idx << 1) + 1;
      const rightIdx = leftIdx + 1;
      if (leftIdx < len && this.items[leftIdx].priority < node.priority) {
        swapIdx = leftIdx;
      }
      if (
        rightIdx < len &&
        this.items[rightIdx].priority <
          (swapIdx === -1 ? node.priority : this.items[swapIdx].priority)
      ) {
        swapIdx = rightIdx;
      }
      if (swapIdx === -1) break;
      this.items[idx] = this.items[swapIdx];
      this.items[swapIdx] = node;
      idx = swapIdx;
    }
  }
}

/**
 * Fast spatial A* used for cost matrix estimation (Hungarian assignment)
 * and static reachability checks.
 */
export function findSpatialPath(
  warehouse: WarehouseLayout,
  start: GridCoord,
  goal: GridCoord,
  extraBlockedKeys?: Set<string>,
  atTick?: number
): GridCoord[] | null {
  const walkable = (x: number, y: number) =>
    atTick !== undefined
      ? isCellWalkableAtTick(warehouse, x, y, atTick)
      : isCellWalkable(warehouse, x, y);

  if (start.x === goal.x && start.y === goal.y) return [{ ...start }];
  if (!walkable(goal.x, goal.y)) return null;

  const open = new MinHeap<{ x: number; y: number; g: number }>();
  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();

  const startKey = coordKey(start.x, start.y);
  gScore.set(startKey, 0);
  open.push({ x: start.x, y: start.y, g: 0 }, manhattan(start, goal));

  while (open.size > 0) {
    const curr = open.pop()!;
    const currKey = coordKey(curr.x, curr.y);
    if (curr.x === goal.x && curr.y === goal.y) {
      const path: GridCoord[] = [];
      let k: string | undefined = currKey;
      while (k) {
        const [px, py] = k.split(',').map(Number);
        path.push({ x: px, y: py });
        k = cameFrom.get(k);
      }
      path.reverse();
      return path;
    }

    const bestG = gScore.get(currKey) ?? Infinity;
    if (curr.g > bestG) continue;

    for (const d of DIRS) {
      const nx = curr.x + d.x;
      const ny = curr.y + d.y;
      if (!walkable(nx, ny)) continue;
      const nKey = coordKey(nx, ny);
      if (extraBlockedKeys?.has(nKey) && !(nx === goal.x && ny === goal.y)) {
        continue;
      }
      const tentativeG = curr.g + 1;
      if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
        gScore.set(nKey, tentativeG);
        cameFrom.set(nKey, currKey);
        open.push(
          { x: nx, y: ny, g: tentativeG },
          tentativeG + manhattan({ x: nx, y: ny }, goal)
        );
      }
    }
  }
  return null;
}

export interface SpaceTimePlanOptions {
  robotId: string;
  warehouse: WarehouseLayout;
  start: GridCoord;
  goal: GridCoord;
  startTick: number;
  reservations: ReservationEntry[];
  failedRobotCells: Set<string>;
  occupiedOtherRobotCells?: Set<string>;
  maxHorizon?: number;
  smoothingMode: SmoothingMode;
  smoothingTension: number;
}

/**
 * Space-Time A* planner on (x, y, t) with:
 *  - Vertex reservations (prevents same-cell collisions)
 *  - Edge swap reservations (prevents head-on swaps)
 *  - Narrow passage lock awareness (avoids entering opposing locked passages)
 *  - Wait actions (stay in place when corridors are temporarily reserved)
 */
export function planSpaceTimePath(
  opts: SpaceTimePlanOptions
): SmoothedTrajectory | null {
  const {
    robotId,
    warehouse,
    start,
    goal,
    startTick,
    reservations,
    failedRobotCells,
    occupiedOtherRobotCells,
    maxHorizon = 75,
    smoothingMode,
    smoothingTension,
  } = opts;

  // Only reject immediately if goal is permanently blocked (shelf or endTick === null)
  if (!isCellWalkable(warehouse, goal.x, goal.y)) {
    return null;
  }
  if (start.x === goal.x && start.y === goal.y) {
    return smoothTrajectory(
      [{ x: start.x, y: start.y, tick: startTick }],
      warehouse,
      smoothingMode,
      smoothingTension
    );
  }

  // Index reservations by tick for O(1) conflict queries
  const vertexRes = new Map<number, Set<string>>();
  const edgeRes = new Map<number, Set<string>>();

  for (const res of reservations) {
    if (res.robotId === robotId) continue;
    if (res.kind === 'CELL') {
      let set = vertexRes.get(res.tick);
      if (!set) {
        set = new Set();
        vertexRes.set(res.tick, set);
      }
      set.add(coordKey(res.x, res.y));
    } else if (
      res.kind === 'EDGE' &&
      res.fromX !== undefined &&
      res.fromY !== undefined
    ) {
      let set = edgeRes.get(res.tick);
      if (!set) {
        set = new Set();
        edgeRes.set(res.tick, set);
      }
      // Record the reverse direction so another robot cannot swap head-on at tick `res.tick`
      set.add(`${res.x},${res.y}->${res.fromX},${res.fromY}`);
    }
  }

  const isCellReserved = (x: number, y: number, tick: number): boolean => {
    return vertexRes.get(tick)?.has(coordKey(x, y)) ?? false;
  };

  const isEdgeSwapConflict = (
    fx: number,
    fy: number,
    tx: number,
    ty: number,
    tick: number
  ): boolean => {
    return edgeRes.get(tick)?.has(`${fx},${fy}->${tx},${ty}`) ?? false;
  };

  const open = new MinHeap<{
    x: number;
    y: number;
    t: number;
    g: number;
  }>();
  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();

  const stKey = (x: number, y: number, t: number) => `${x},${y},${t}`;
  const startKey = stKey(start.x, start.y, 0);
  gScore.set(startKey, 0);
  open.push(
    { x: start.x, y: start.y, t: 0, g: 0 },
    manhattan(start, goal)
  );

  let bestGoalKey: string | null = null;

  while (open.size > 0) {
    const curr = open.pop()!;
    const currKey = stKey(curr.x, curr.y, curr.t);

    if (curr.x === goal.x && curr.y === goal.y) {
      bestGoalKey = currKey;
      break;
    }

    if (curr.t >= maxHorizon) continue;

    const recordedG = gScore.get(currKey) ?? Infinity;
    if (curr.g > recordedG) continue;

    const nextDt = curr.t + 1;
    const absNextTick = startTick + nextDt;

    // 4 cardinal moves + 1 wait move
    const candidates: { nx: number; ny: number; stepCost: number }[] = [
      ...DIRS.map((d) => ({
        nx: curr.x + d.x,
        ny: curr.y + d.y,
        stepCost: 1,
      })),
      { nx: curr.x, ny: curr.y, stepCost: 1.08 },
    ];

    for (const { nx, ny, stepCost } of candidates) {
      // Time-dependent node check: respects startTick & endTick of temporary dynamic obstacles
      if (!isCellWalkableAtTick(warehouse, nx, ny, absNextTick)) continue;
      const nCellKey = coordKey(nx, ny);

      // Failed robots permanently block their cell until repaired
      if (failedRobotCells.has(nCellKey)) continue;

      // Avoid stepping into currently occupied cells on the immediate first tick
      if (
        nextDt === 1 &&
        occupiedOtherRobotCells?.has(nCellKey) &&
        !(nx === curr.x && ny === curr.y)
      ) {
        continue;
      }

      // Check space-time vertex & edge conflicts
      if (isCellReserved(nx, ny, absNextTick)) continue;
      if (
        !(nx === curr.x && ny === curr.y) &&
        isEdgeSwapConflict(curr.x, curr.y, nx, ny, absNextTick)
      ) {
        continue;
      }

      // Check narrow passage lock when entering a locked passage from outside
      let passagePenalty = 0;
      if (nextDt <= 6) {
        const passageInfo = getPassageForCell(warehouse, nx, ny);
        if (
          passageInfo &&
          passageInfo.passage.lockedByRobotId &&
          passageInfo.passage.lockedByRobotId !== robotId
        ) {
          // Strongly penalize or avoid entering a passage locked by another robot right now
          passagePenalty = 6;
        }
      }

      const tentativeG = curr.g + stepCost + passagePenalty;
      const nextKey = stKey(nx, ny, nextDt);
      if (tentativeG < (gScore.get(nextKey) ?? Infinity)) {
        gScore.set(nextKey, tentativeG);
        cameFrom.set(nextKey, currKey);
        const h = manhattan({ x: nx, y: ny }, goal);
        open.push({ x: nx, y: ny, t: nextDt, g: tentativeG }, tentativeG + h);
      }
    }
  }

  if (!bestGoalKey) {
    // Fallback to spatial A* respecting currently active obstacles at startTick
    const fallback = findSpatialPath(
      warehouse,
      start,
      goal,
      failedRobotCells,
      startTick
    );
    if (!fallback) return null;
    const rawSteps: SpaceTimeStep[] = fallback.map((pt, i) => ({
      x: pt.x,
      y: pt.y,
      tick: startTick + i,
    }));
    return smoothTrajectory(rawSteps, warehouse, smoothingMode, smoothingTension);
  }

  const rawSteps: SpaceTimeStep[] = [];
  let trace: string | undefined = bestGoalKey;
  while (trace) {
    const [x, y, dt] = trace.split(',').map(Number);
    rawSteps.push({ x, y, tick: startTick + dt });
    trace = cameFrom.get(trace);
  }
  rawSteps.reverse();

  return smoothTrajectory(rawSteps, warehouse, smoothingMode, smoothingTension);
}

/**
 * Checks whether a continuous point (in grid coordinates where cell center is x+0.5, y+0.5)
 * maintains a safe clearance radius from any static shelf or dynamic obstacle.
 */
function clampPointFromObstacles(
  pt: Point2D,
  fallbackPt: Point2D,
  warehouse: WarehouseLayout,
  clearanceRadius = 0.34
): Point2D {
  const minX = Math.floor(pt.x - clearanceRadius);
  const maxX = Math.floor(pt.x + clearanceRadius);
  const minY = Math.floor(pt.y - clearanceRadius);
  const maxY = Math.floor(pt.y + clearanceRadius);

  let collides = false;
  for (let cy = minY; cy <= maxY; cy++) {
    for (let cx = minX; cx <= maxX; cx++) {
      if (!isCellWalkable(warehouse, cx, cy)) {
        // Closest point on obstacle cell [cx, cx+1] x [cy, cy+1]
        const closestX = Math.max(cx, Math.min(pt.x, cx + 1));
        const closestY = Math.max(cy, Math.min(pt.y, cy + 1));
        const dx = pt.x - closestX;
        const dy = pt.y - closestY;
        if (dx * dx + dy * dy < clearanceRadius * clearanceRadius) {
          collides = true;
          break;
        }
      }
    }
    if (collides) break;
  }

  if (!collides) return pt;

  // Binary pull back toward the guaranteed safe grid centerline point
  let lo = 0;
  let hi = 1;
  let safe = { ...fallbackPt };
  for (let iter = 0; iter < 6; iter++) {
    const mid = (lo + hi) * 0.5;
    const testX = fallbackPt.x + (pt.x - fallbackPt.x) * mid;
    const testY = fallbackPt.y + (pt.y - fallbackPt.y) * mid;
    let hit = false;
    for (let cy = Math.floor(testY - clearanceRadius); cy <= Math.floor(testY + clearanceRadius); cy++) {
      for (let cx = Math.floor(testX - clearanceRadius); cx <= Math.floor(testX + clearanceRadius); cx++) {
        if (!isCellWalkable(warehouse, cx, cy)) {
          const closestX = Math.max(cx, Math.min(testX, cx + 1));
          const closestY = Math.max(cy, Math.min(testY, cy + 1));
          const dx = testX - closestX;
          const dy = testY - closestY;
          if (dx * dx + dy * dy < clearanceRadius * clearanceRadius) {
            hit = true;
            break;
          }
        }
      }
      if (hit) break;
    }
    if (!hit) {
      safe = { x: testX, y: testY };
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return safe;
}

/**
 * Catmull-Rom interpolation between p1 and p2 using neighbors p0 and p3.
 */
function evalCatmullRom(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  t: number,
  tension: number
): Point2D {
  const s = (1 - tension) * 0.5;
  const t2 = t * t;
  const t3 = t2 * t;

  const h1 = -s * t3 + 2 * s * t2 - s * t;
  const h2 = (2 - s) * t3 + (s - 3) * t2 + 1;
  const h3 = (s - 2) * t3 + (3 - 2 * s) * t2 + s * t;
  const h4 = s * t3 - s * t2;

  return {
    x: h1 * p0.x + h2 * p1.x + h3 * p2.x + h4 * p3.x,
    y: h1 * p0.y + h2 * p1.y + h3 * p2.y + h4 * p3.y,
  };
}

/**
 * Path Smoother:
 * Transforms discrete Space-Time A* grid steps into a fluid geometric curve
 * of intermediate spline points while keeping exact step-to-spline correspondence
 * for tick-synchronized coordinator motion and obstacle-safe corner rounding.
 */
export function smoothTrajectory(
  rawSteps: SpaceTimeStep[],
  warehouse: WarehouseLayout,
  mode: SmoothingMode,
  tension = 0.45
): SmoothedTrajectory {
  const toCenter = (s: SpaceTimeStep): Point2D => ({
    x: s.x + 0.5,
    y: s.y + 0.5,
  });

  if (rawSteps.length <= 1) {
    const pt = rawSteps[0] ? toCenter(rawSteps[0]) : { x: 0.5, y: 0.5 };
    return {
      mode,
      tension,
      rawSteps,
      controlPoints: [pt],
      splinePoints: [{ x: pt.x, y: pt.y, stepIndex: 0, arcFraction: 0 }],
      stepToSplineRange: [{ start: 0, end: 0 }],
      totalArcLength: 0,
      rawManhattanLength: 0,
    };
  }

  // Build spatial control polyline excluding duplicate wait steps so corner tangents remain smooth
  const spatialIndices: number[] = [0];
  for (let i = 1; i < rawSteps.length; i++) {
    const prev = rawSteps[spatialIndices[spatialIndices.length - 1]];
    if (rawSteps[i].x !== prev.x || rawSteps[i].y !== prev.y) {
      spatialIndices.push(i);
    }
  }

  const spatialPoints = spatialIndices.map((idx) => toCenter(rawSteps[idx]));
  const stepToSpatialIdx = new Map<number, number>();
  for (let k = 0; k < spatialIndices.length; k++) {
    stepToSpatialIdx.set(spatialIndices[k], k);
  }

  // For Chaikin mode, compute corner-cut control points for visualization
  let controlPoints: Point2D[] = [...spatialPoints];
  if (mode === 'CHAIKIN' && spatialPoints.length >= 3) {
    const cutAmt = 0.15 + tension * 0.25; // maps tension 0..1 -> 0.15..0.40
    const nextPts: Point2D[] = [spatialPoints[0]];
    for (let i = 0; i < spatialPoints.length - 1; i++) {
      const a = spatialPoints[i];
      const b = spatialPoints[i + 1];
      if (i > 0) {
        nextPts.push(
          clampPointFromObstacles(
            {
              x: a.x + (b.x - a.x) * cutAmt,
              y: a.y + (b.y - a.y) * cutAmt,
            },
            a,
            warehouse
          )
        );
      }
      if (i < spatialPoints.length - 2) {
        nextPts.push(
          clampPointFromObstacles(
            {
              x: a.x + (b.x - a.x) * (1 - cutAmt),
              y: a.y + (b.y - a.y) * (1 - cutAmt),
            },
            b,
            warehouse
          )
        );
      }
    }
    nextPts.push(spatialPoints[spatialPoints.length - 1]);
    controlPoints = nextPts;
  }

  const SAMPLES_PER_STEP = 10;
  const splinePoints: SplinePoint[] = [];
  const stepToSplineRange: { start: number; end: number }[] = [];

  let activeSpatialIdx = 0;
  for (let i = 0; i < rawSteps.length - 1; i++) {
    const sCurr = rawSteps[i];
    const sNext = rawSteps[i + 1];
    const isWait = sCurr.x === sNext.x && sCurr.y === sNext.y;
    const rangeStart = splinePoints.length;

    if (isWait) {
      const pt = toCenter(sCurr);
      splinePoints.push({
        x: pt.x,
        y: pt.y,
        stepIndex: i,
        arcFraction: 0,
      });
      stepToSplineRange.push({ start: rangeStart, end: rangeStart });
      continue;
    }

    const p1 = spatialPoints[activeSpatialIdx];
    const p2 = spatialPoints[activeSpatialIdx + 1] ?? p1;
    const p0 = spatialPoints[Math.max(0, activeSpatialIdx - 1)];
    const p3 =
      spatialPoints[Math.min(spatialPoints.length - 1, activeSpatialIdx + 2)];

    for (let k = 0; k <= SAMPLES_PER_STEP; k++) {
      const t = k / SAMPLES_PER_STEP;
      const linearPt: Point2D = {
        x: p1.x + (p2.x - p1.x) * t,
        y: p1.y + (p2.y - p1.y) * t,
      };

      let pt: Point2D = linearPt;
      if (mode === 'CATMULL_ROM' && spatialPoints.length >= 3) {
        const crPt = evalCatmullRom(p0, p1, p2, p3, t, tension);
        pt = clampPointFromObstacles(crPt, linearPt, warehouse);
      } else if (mode === 'CHAIKIN' && spatialPoints.length >= 3) {
        // Quadratic Bezier corner blend around turns using Chaikin quarter-points
        const prevPt = p0;
        const nextPt = p3;
        const midIn: Point2D =
          activeSpatialIdx > 0
            ? { x: (prevPt.x + p1.x) * 0.5, y: (prevPt.y + p1.y) * 0.5 }
            : p1;
        const midOut: Point2D =
          activeSpatialIdx + 1 < spatialPoints.length - 1
            ? { x: (p2.x + nextPt.x) * 0.5, y: (p2.y + nextPt.y) * 0.5 }
            : p2;
        const cornerBlend = 0.25 + tension * 0.35;
        // Blend between straight segment and smooth quadratic entry/exit
        const qIn = {
          x: p1.x + (midIn.x - p1.x) * cornerBlend * (1 - t),
          y: p1.y + (midIn.y - p1.y) * cornerBlend * (1 - t),
        };
        const qOut = {
          x: p2.x + (midOut.x - p2.x) * cornerBlend * t,
          y: p2.y + (midOut.y - p2.y) * cornerBlend * t,
        };
        const blended = {
          x: qIn.x * (1 - t) + qOut.x * t,
          y: qIn.y * (1 - t) + qOut.y * t,
        };
        pt = clampPointFromObstacles(blended, linearPt, warehouse);
      }

      splinePoints.push({
        x: pt.x,
        y: pt.y,
        stepIndex: i,
        arcFraction: 0,
      });
    }

    stepToSplineRange.push({
      start: rangeStart,
      end: splinePoints.length - 1,
    });
    activeSpatialIdx++;
  }

  // Compute total arc length & normalized fractions
  let totalArcLength = 0;
  for (let i = 1; i < splinePoints.length; i++) {
    const dx = splinePoints[i].x - splinePoints[i - 1].x;
    const dy = splinePoints[i].y - splinePoints[i - 1].y;
    totalArcLength += Math.hypot(dx, dy);
  }

  let accum = 0;
  for (let i = 0; i < splinePoints.length; i++) {
    if (i > 0) {
      accum += Math.hypot(
        splinePoints[i].x - splinePoints[i - 1].x,
        splinePoints[i].y - splinePoints[i - 1].y
      );
    }
    splinePoints[i].arcFraction = totalArcLength > 0 ? accum / totalArcLength : 0;
  }

  return {
    mode,
    tension,
    rawSteps,
    controlPoints,
    splinePoints,
    stepToSplineRange,
    totalArcLength,
    rawManhattanLength: Math.max(0, spatialPoints.length - 1),
  };
}
