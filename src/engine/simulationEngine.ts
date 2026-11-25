import {
  AllocationStrategy,
  ArenaEvent,
  ArenaEventType,
  GridCoord,
  Job,
  JobGenerationMode,
  PackageRecord,
  ReservationEntry,
  Robot,
  SimulationStateSnapshot,
  SmoothingMode,
  TickMetricSnapshot,
  WaitEdge,
  WarehouseLayout,
} from './types';
import {
  canToggleDynamicBlock,
  cloneWarehouse,
  coordKey,
  createWarehouseLayout,
  manhattan,
  sameCoord,
  WarehousePresetId,
} from './warehouseManager';
import { planSpaceTimePath, smoothTrajectory } from './pathPlanner';
import { allocateJobs, findBestHandoffCell } from './jobAllocator';
import {
  deliverPackageTransaction,
  markPackageStrandedOnFailure,
  pickupPackageTransaction,
  transferPackageTransaction,
} from './packageManager';
import {
  buildReservationTable,
  coordinateFleetTick,
} from './trafficCoordinator';

const ROBOT_COLORS = [
  '#0284c7', // Azure
  '#0d9488', // Teal
  '#d97706', // Amber
  '#4f46e5', // Indigo
  '#059669', // Emerald
  '#be123c', // Rose
];

export class WarehouseSimulationEngine {
  private tick = 0;
  private running = false;
  private speedMultiplier = 1;
  private readonly baseTickMs = 200; // 5 ticks per second
  private allocationStrategy: AllocationStrategy = 'HUNGARIAN';
  private smoothingMode: SmoothingMode = 'CATMULL_ROM';
  private smoothingTension = 0.55;

  private warehouse: WarehouseLayout;
  private robots: Robot[] = [];
  private jobs: Job[] = [];
  private packages: PackageRecord[] = [];
  private reservations: ReservationEntry[] = [];
  private waitEdges: WaitEdge[] = [];
  private events: ArenaEvent[] = [];
  private metricsHistory: TickMetricSnapshot[] = [];

  private jobCounter = 0;
  private pkgCounter = 0;
  private eventCounter = 0;
  private replanCount = 0;
  private deadlockCount = 0;
  private jobMode: JobGenerationMode = 'AUTO';
  private autoJobsPlaying = true;

  constructor(presetId: WarehousePresetId = 'narrow_hub') {
    this.warehouse = createWarehouseLayout(presetId);
    this.initializeFleet(presetId);
    this.seedInitialJobs();
    this.recordMetricsSnapshot();
  }

  private formatSimTimestamp(tick: number): string {
    const totalSeconds = Math.floor(tick / 5);
    const hrs = 10 + Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    const ms = (tick % 5) * 200;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms / 100)}`;
  }

  private emitEvent(
    type: ArenaEventType,
    entityId: string,
    message: string
  ): void {
    this.eventCounter++;
    this.events.unshift({
      id: `EVT-${String(this.eventCounter).padStart(4, '0')}`,
      tick: this.tick,
      timestamp: this.formatSimTimestamp(this.tick),
      type,
      entityId,
      message,
    });
    if (this.events.length > 250) {
      this.events.length = 250;
    }
  }

  private initializeFleet(presetId: WarehousePresetId): void {
    const count = presetId === 'dense_matrix' ? 6 : 5;
    const spawnCoords: GridCoord[] = [
      ...this.warehouse.chargingBays,
      ...this.warehouse.pickupStations.map((p) => p.coord),
    ];

    this.robots = [];
    for (let i = 0; i < count; i++) {
      const coord = spawnCoords[i % spawnCoords.length] ?? { x: i, y: 0 };
      const id = `R0${i + 1}`;
      this.robots.push({
        id,
        name: `Unit ${id}`,
        x: coord.x,
        y: coord.y,
        prevX: coord.x,
        prevY: coord.y,
        heading: 0,
        status: 'IDLE',
        battery: 96 - i * 4,
        jobId: null,
        carryingPackageId: null,
        recoveryTargetRobotId: null,
        path: null,
        pathStepIndex: 0,
        waitTicks: 0,
        totalWaitTicks: 0,
        totalMoves: 0,
        priority: count - i,
        lastReplanTick: -10,
        color: ROBOT_COLORS[i % ROBOT_COLORS.length],
        blockedWarningTick: null,
      });
    }
  }

  private seedInitialJobs(): void {
    const pickups = this.warehouse.pickupStations;
    const drops = this.warehouse.dropStations;
    if (pickups.length === 0 || drops.length === 0) return;

    for (let i = 0; i < 4; i++) {
      const p = pickups[i % pickups.length];
      const d = drops[(i + 1) % drops.length];
      this.createJob(p.coord, d.coord, i === 0 ? 3 : 2);
    }
  }

  public reset(presetId?: WarehousePresetId): void {
    const targetPreset =
      presetId ?? (this.warehouse.id as WarehousePresetId) ?? 'narrow_hub';
    this.tick = 0;
    this.running = false;
    this.jobCounter = 0;
    this.pkgCounter = 0;
    this.eventCounter = 0;
    this.replanCount = 0;
    this.deadlockCount = 0;
    this.jobs = [];
    this.packages = [];
    this.reservations = [];
    this.waitEdges = [];
    this.events = [];
    this.metricsHistory = [];
    this.warehouse = createWarehouseLayout(targetPreset);
    this.initializeFleet(targetPreset);
    if (this.jobMode === 'AUTO') {
      this.seedInitialJobs();
    }
    this.recordMetricsSnapshot();
  }

  public setRunning(running: boolean): void {
    this.running = running;
  }

  public setSpeedMultiplier(speed: number): void {
    this.speedMultiplier = speed;
  }

  public setAllocationStrategy(strategy: AllocationStrategy): void {
    this.allocationStrategy = strategy;
  }

  public setJobMode(mode: JobGenerationMode): void {
    this.jobMode = mode;
    if (mode === 'AUTO') {
      this.autoJobsPlaying = true;
    }
  }

  public setAutoJobsPlaying(playing: boolean): void {
    this.autoJobsPlaying = playing;
  }

  public clearPendingJobs(): number {
    const before = this.jobs.length;
    const removedPkgIds = new Set<string>();
    this.jobs = this.jobs.filter((j) => {
      if (j.status === 'PENDING' && j.assignedRobotId === null) {
        removedPkgIds.add(j.packageId);
        return false;
      }
      return true;
    });
    this.packages = this.packages.filter((p) => !removedPkgIds.has(p.id));
    return before - this.jobs.length;
  }

  public setSmoothingConfig(mode: SmoothingMode, tension: number): void {
    this.smoothingMode = mode;
    this.smoothingTension = Math.max(0, Math.min(1, tension));
    // Re-smooth all existing robot trajectories immediately so UI slider gives instant live visual feedback!
    for (const r of this.robots) {
      if (r.path && r.path.rawSteps.length > 0) {
        r.path = smoothTrajectory(
          r.path.rawSteps,
          this.warehouse,
          this.smoothingMode,
          this.smoothingTension
        );
      }
    }
  }

  public addRobot(): Robot | null {
    if (this.robots.length >= 10) return null;
    const occupied = new Set(this.robots.map((r) => coordKey(r.x, r.y)));
    const candidates = [
      ...this.warehouse.chargingBays,
      ...this.warehouse.pickupStations.map((s) => s.coord),
    ];
    let spawn: GridCoord | null = null;
    for (const c of candidates) {
      if (
        !occupied.has(coordKey(c.x, c.y)) &&
        !this.warehouse.dynamicObstacles.has(coordKey(c.x, c.y))
      ) {
        spawn = c;
        break;
      }
    }
    if (!spawn) {
      for (let y = 0; y < this.warehouse.rows; y++) {
        for (let x = 0; x < this.warehouse.cols; x++) {
          if (
            this.warehouse.grid[y][x] === 'FLOOR' &&
            !occupied.has(coordKey(x, y)) &&
            !this.warehouse.dynamicObstacles.has(coordKey(x, y))
          ) {
            spawn = { x, y };
            break;
          }
        }
        if (spawn) break;
      }
    }
    if (!spawn) return null;

    const idx = this.robots.length;
    const id = `R${String(idx + 1).padStart(2, '0')}`;
    const robot: Robot = {
      id,
      name: `Unit ${id}`,
      x: spawn.x,
      y: spawn.y,
      prevX: spawn.x,
      prevY: spawn.y,
      heading: 0,
      status: 'IDLE',
      battery: 100,
      jobId: null,
      carryingPackageId: null,
      recoveryTargetRobotId: null,
      path: null,
      pathStepIndex: 0,
      waitTicks: 0,
      totalWaitTicks: 0,
      totalMoves: 0,
      priority: 2,
      lastReplanTick: -10,
      color: ROBOT_COLORS[idx % ROBOT_COLORS.length],
      blockedWarningTick: null,
    };
    this.robots.push(robot);
    return robot;
  }

  public createJob(
    pickup: GridCoord,
    drop: GridCoord,
    priority = 2,
    customLabel?: string
  ): Job {
    this.jobCounter++;
    this.pkgCounter++;
    const jobId = `J${String(this.jobCounter).padStart(3, '0')}`;
    const pkgId = `P${String(this.pkgCounter).padStart(3, '0')}`;
    const trimmed = customLabel?.trim();
    const pkgLabel = trimmed && trimmed.length > 0 ? trimmed : `Crate ${pkgId}`;

    const pkg: PackageRecord = {
      id: pkgId,
      jobId,
      label: pkgLabel,
      status: 'AT_PICKUP',
      carrierRobotId: null,
      lastKnownPos: { ...pickup },
      custodyHistory: [
        {
          tick: this.tick,
          fromRobotId: null,
          toRobotId: null,
          action: 'MANIFEST_CREATED',
        },
      ],
    };

    const job: Job = {
      id: jobId,
      packageId: pkgId,
      packageLabel: pkgLabel,
      pickup: { ...pickup },
      drop: { ...drop },
      priority,
      status: 'PENDING',
      assignedRobotId: null,
      createdAtTick: this.tick,
      startedAtTick: null,
      completedAtTick: null,
    };

    this.packages.push(pkg);
    this.jobs.unshift(job);
    this.emitEvent(
      'JOB_CREATED',
      jobId,
      `${jobId} (${pkgLabel}) queued from (${pickup.x},${pickup.y}) to (${drop.x},${drop.y})`
    );
    return job;
  }

  public createRandomJob(): Job {
    const pickups = this.warehouse.pickupStations;
    const drops = this.warehouse.dropStations;
    const p = pickups[Math.floor(Math.random() * pickups.length)];
    const d = drops[Math.floor(Math.random() * drops.length)];
    const priority = Math.random() < 0.25 ? 3 : Math.random() < 0.6 ? 2 : 1;
    return this.createJob(p.coord, d.coord, priority);
  }

  private getGoalForRobot(robot: Robot): GridCoord | null {
    if (!robot.jobId) return null;
    const job = this.jobs.find((j) => j.id === robot.jobId);
    if (!job) return null;

    if (robot.status === 'CARRYING_TO_DROP') {
      return job.drop;
    }
    if (robot.status === 'RECOVERING_PACKAGE') {
      const pkg = this.packages.find((p) => p.id === job.packageId);
      if (!pkg) return null;
      const failedCells = new Set(
        this.robots
          .filter((r) => r.status === 'FAILED')
          .map((r) => coordKey(r.x, r.y))
      );
      return findBestHandoffCell(
        this.warehouse,
        { x: robot.x, y: robot.y },
        pkg.lastKnownPos,
        failedCells
      );
    }
    return job.pickup;
  }

  private planPathForRobot(robot: Robot, goal: GridCoord): boolean {
    const failedCells = new Set(
      this.robots
        .filter((r) => r.status === 'FAILED')
        .map((r) => coordKey(r.x, r.y))
    );
    const occupiedOthers = new Set(
      this.robots
        .filter((r) => r.id !== robot.id)
        .map((r) => coordKey(r.x, r.y))
    );

    const reservations = buildReservationTable(this.robots, this.tick);
    const traj = planSpaceTimePath({
      robotId: robot.id,
      warehouse: this.warehouse,
      start: { x: robot.x, y: robot.y },
      goal,
      startTick: this.tick,
      reservations,
      failedRobotCells: failedCells,
      occupiedOtherRobotCells: occupiedOthers,
      smoothingMode: this.smoothingMode,
      smoothingTension: this.smoothingTension,
    });

    if (!traj) return false;
    robot.path = traj;
    robot.pathStepIndex = 0;
    robot.lastReplanTick = this.tick;
    return true;
  }

  /**
   * Dynamically blocks or unblocks a cell in the warehouse grid.
   * Supports permanent (durationTicks = null) or time-dependent temporary blockages
   * ([startTick, endTick)) and proactively replans affected Space-Time A* paths.
   */
  public toggleDynamicBlock(
    x: number,
    y: number,
    source: 'USER' | 'SCENARIO' = 'USER',
    reason = 'Dynamic aisle obstruction',
    options?: { delayTicks?: number; durationTicks?: number | null }
  ): { ok: boolean; blocked?: boolean; message: string } {
    const check = canToggleDynamicBlock(this.warehouse, x, y);
    if (!check.allowed) {
      return { ok: false, message: check.reason ?? 'Cell cannot be blocked' };
    }

    const key = coordKey(x, y);
    const isCurrentlyBlocked = this.warehouse.dynamicObstacles.has(key);

    if (!isCurrentlyBlocked) {
      const delay = Math.max(0, options?.delayTicks ?? 0);
      const duration =
        options?.durationTicks === undefined ? null : options.durationTicks;
      const startTick = this.tick + delay;
      const endTick = duration !== null ? startTick + duration : null;

      // Do not drop an immediate obstacle directly on top of a robot's current cell
      if (delay === 0) {
        const occupant = this.robots.find((r) => r.x === x && r.y === y);
        if (occupant) {
          return {
            ok: false,
            message: `Cell (${x},${y}) is currently occupied by ${occupant.id}`,
          };
        }
      }

      this.warehouse.dynamicObstacles.set(key, {
        x,
        y,
        status: 'BLOCKED',
        startTick,
        endTick,
        durationTicks: duration,
        reason,
        blockedAtTick: this.tick,
        source,
      });

      const windowLabel =
        endTick !== null
          ? `T${startTick}..T${endTick}`
          : `T${startTick}..∞`;
      this.emitEvent(
        'OBSTACLE_BLOCKED',
        `(${x},${y})`,
        `Cell (${x},${y}) flagged BLOCKED [${windowLabel}] (${reason})`
      );

      // Proactively detect every robot whose scheduled (x, y, tick) intersects [startTick, endTick)
      for (const r of this.robots) {
        if (r.status === 'FAILED' || r.status === 'IDLE' || !r.path) continue;
        const remaining = r.path.rawSteps.slice(r.pathStepIndex);
        const intersects = remaining.some(
          (s) =>
            s.x === x &&
            s.y === y &&
            s.tick >= startTick &&
            (endTick === null || s.tick < endTick)
        );
        if (intersects) {
          r.blockedWarningTick = this.tick;
          const goal = this.getGoalForRobot(r);
          if (goal) {
            const replanned = this.planPathForRobot(r, goal);
            if (replanned) {
              this.replanCount++;
              this.emitEvent(
                'PATH_RECALCULATED',
                r.id,
                `${r.id} proactively routed around (${x},${y}) [${windowLabel}]`
              );
            }
          }
        }
      }

      this.reservations = buildReservationTable(this.robots, this.tick);
      return {
        ok: true,
        blocked: true,
        message: `Flagged (${x},${y}) BLOCKED [${windowLabel}] and updated routes`,
      };
    } else {
      this.warehouse.dynamicObstacles.delete(key);
      this.emitEvent(
        'OBSTACLE_UNBLOCKED',
        `(${x},${y})`,
        `Aisle cell (${x},${y}) cleared and reopened`
      );

      // Re-evaluate active robots so they can exploit the reopened shortcut!
      for (const r of this.robots) {
        if (r.status === 'FAILED' || r.status === 'IDLE') continue;
        const goal = this.getGoalForRobot(r);
        if (goal) {
          const oldLen = r.path
            ? r.path.rawSteps.length - r.pathStepIndex
            : Infinity;
          const prevPath = r.path;
          const prevIdx = r.pathStepIndex;
          if (this.planPathForRobot(r, goal)) {
            const newLen = r.path ? r.path.rawSteps.length : Infinity;
            if (newLen + 1 < oldLen) {
              this.replanCount++;
              this.emitEvent(
                'PATH_RECALCULATED',
                r.id,
                `${r.id} rerouted through reopened cell (${x},${y})`
              );
            } else {
              // Keep stable path if reopened cell doesn't meaningfully shorten route
              r.path = prevPath;
              r.pathStepIndex = prevIdx;
            }
          }
        }
      }

      this.reservations = buildReservationTable(this.robots, this.tick);
      return {
        ok: true,
        blocked: false,
        message: `Unblocked (${x},${y})`,
      };
    }
  }

  /**
   * Simulates an abrupt hardware failure on a robot.
   * Retains package custody on the failed robot until a recovery robot completes transfer!
   */
  public failRobot(robotId: string): boolean {
    const robot = this.robots.find((r) => r.id === robotId);
    if (!robot || robot.status === 'FAILED') return false;

    robot.status = 'FAILED';
    robot.path = null;
    robot.pathStepIndex = 0;

    // Release any narrow passage lock held by the failed robot
    for (const p of this.warehouse.passages) {
      if (p.lockedByRobotId === robot.id) {
        p.lockedByRobotId = null;
        p.lockedDirection = 0;
        this.emitEvent(
          'AISLE_RELEASED',
          p.id,
          `${p.name} lock released after ${robot.id} fault`
        );
      }
    }

    this.emitEvent(
      'ROBOT_FAILED',
      robot.id,
      `${robot.id} faulted at (${robot.x},${robot.y})`
    );

    // Handle active job & package custody
    if (robot.jobId) {
      const job = this.jobs.find((j) => j.id === robot.jobId);
      if (job) {
        if (robot.carryingPackageId) {
          const pkg = this.packages.find(
            (p) => p.id === robot.carryingPackageId
          );
          if (pkg) {
            markPackageStrandedOnFailure(pkg, robot, this.tick);
            job.status = 'RECOVERY_PENDING';
            job.assignedRobotId = null;
            this.emitEvent(
              'PACKAGE_RECOVERY_STARTED',
              pkg.id,
              `${pkg.id} stranded on ${robot.id} at (${robot.x},${robot.y}); custody retained pending recovery`
            );
          }
        } else {
          // Robot had not picked up package yet — return job cleanly to PENDING
          job.status = 'PENDING';
          job.assignedRobotId = null;
        }
      }
      robot.jobId = null;
    }

    // Replan any active robots whose path passes through the failed robot's cell
    for (const other of this.robots) {
      if (other.id === robot.id || other.status === 'FAILED' || !other.path) {
        continue;
      }
      const intersects = other.path.rawSteps
        .slice(other.pathStepIndex)
        .some((s) => s.x === robot.x && s.y === robot.y);
      if (intersects) {
        const goal = this.getGoalForRobot(other);
        if (goal && this.planPathForRobot(other, goal)) {
          this.replanCount++;
          this.emitEvent(
            'PATH_RECALCULATED',
            other.id,
            `${other.id} rerouted around failed unit ${robot.id}`
          );
        }
      }
    }

    return true;
  }

  public repairRobot(robotId: string): boolean {
    const robot = this.robots.find((r) => r.id === robotId);
    if (!robot || robot.status !== 'FAILED') return false;
    robot.status = 'IDLE';
    robot.battery = Math.max(robot.battery, 75);
    robot.waitTicks = 0;
    this.emitEvent(
      'ROBOT_REPAIRED',
      robot.id,
      `${robot.id} restored to service at (${robot.x},${robot.y})`
    );
    return true;
  }

  /**
   * Advances the discrete-event simulation by 1 tick.
   */
  public stepTick(): void {
    this.tick++;

    // 0. Expire temporary time-dependent obstacles whose endTick has elapsed
    const expiredKeys: string[] = [];
    for (const [key, obs] of this.warehouse.dynamicObstacles.entries()) {
      if (obs.endTick !== null && this.tick >= obs.endTick) {
        expiredKeys.push(key);
      }
    }
    if (expiredKeys.length > 0) {
      for (const k of expiredKeys) {
        const obs = this.warehouse.dynamicObstacles.get(k)!;
        this.warehouse.dynamicObstacles.delete(k);
        this.emitEvent(
          'OBSTACLE_UNBLOCKED',
          `(${obs.x},${obs.y})`,
          `Temporary block at (${obs.x},${obs.y}) expired at T${this.tick}`
        );
      }
    }

    // Keep fleet busy in AUTO mode when auto-job generation is playing
    if (this.jobMode === 'AUTO' && this.autoJobsPlaying) {
      const openJobs = this.jobs.filter((j) => j.status !== 'COMPLETED').length;
      if (openJobs < 3 && this.tick % 4 === 0) {
        this.createRandomJob();
      }
    }

    // 1. Allocate unassigned PENDING / RECOVERY_PENDING jobs to IDLE robots
    const assignments = allocateJobs(
      this.robots,
      this.jobs,
      this.packages,
      this.warehouse,
      this.allocationStrategy,
      this.tick
    );

    for (const pair of assignments) {
      const robot = this.robots.find((r) => r.id === pair.robotId);
      const job = this.jobs.find((j) => j.id === pair.jobId);
      if (!robot || !job) continue;

      job.assignedRobotId = robot.id;
      job.startedAtTick = job.startedAtTick ?? this.tick;

      if (pair.isRecovery) {
        const pkg = this.packages.find((p) => p.id === job.packageId);
        job.status = 'IN_PROGRESS';
        robot.status = 'RECOVERING_PACKAGE';
        robot.jobId = job.id;
        robot.recoveryTargetRobotId = pkg?.carrierRobotId ?? null;
        if (pkg) pkg.status = 'RECOVERING';
        this.planPathForRobot(robot, pair.targetCoord);
        this.emitEvent(
          'ROBOT_ASSIGNED',
          robot.id,
          `${robot.id} dispatched to recover ${job.packageId} from ${robot.recoveryTargetRobotId}`
        );
      } else {
        job.status = 'ASSIGNED';
        robot.status = 'MOVING_TO_PICKUP';
        robot.jobId = job.id;
        this.planPathForRobot(robot, job.pickup);
        this.emitEvent(
          'ROBOT_ASSIGNED',
          robot.id,
          `${robot.id} assigned ${job.id} (${this.allocationStrategy})`
        );
      }
    }

    // 2. Ensure every active robot has a valid path
    for (const r of this.robots) {
      if (r.status === 'FAILED' || r.status === 'IDLE') continue;
      if (!r.path || r.path.rawSteps.length === 0) {
        const goal = this.getGoalForRobot(r);
        if (goal) this.planPathForRobot(r, goal);
      }
    }

    // 3. Centralized Fleet Coordination Cycle (simultaneous validation + deadlock detection)
    const outcome = coordinateFleetTick(
      this.robots,
      this.warehouse,
      this.tick,
      this.smoothingMode,
      this.smoothingTension,
      (r) => this.getGoalForRobot(r)
    );

    this.reservations = outcome.reservations;
    this.waitEdges = outcome.waitEdges;

    for (const pe of outcome.passageEvents) {
      this.emitEvent(
        pe.type,
        pe.passageId,
        pe.type === 'AISLE_RESERVED'
          ? `${pe.robotId} locked ${pe.passageName}`
          : `${pe.robotId} exited ${pe.passageName}`
      );
    }

    for (const dl of outcome.deadlocksDetected) {
      this.deadlockCount++;
      this.emitEvent(
        'DEADLOCK_DETECTED',
        dl.cycleRobotIds.join(','),
        `Wait-for cycle [${dl.cycleRobotIds.join(' -> ')}] detected`
      );
      this.emitEvent(
        'DEADLOCK_RESOLVED',
        dl.yieldedRobotId,
        dl.sidesteppedTo
          ? `${dl.yieldedRobotId} yielded to alcove (${dl.sidesteppedTo.x},${dl.sidesteppedTo.y})`
          : `${dl.yieldedRobotId} replanned priority yield`
      );
    }

    for (const rid of outcome.replannedRobotIds) {
      this.replanCount++;
      this.emitEvent(
        'PATH_RECALCULATED',
        rid,
        `${rid} recalculated Space-Time path`
      );
    }

    // 4. Atomic Commit of all approved robot moves
    for (const r of this.robots) {
      r.prevX = r.x;
      r.prevY = r.y;

      if (r.status === 'FAILED') continue;

      const move = outcome.approvedMoves.get(r.id);
      if (!move) continue;

      // Allow evacuated IDLE robots to commit their yield step, while skipping wait stats for IDLE
      if (r.status === 'IDLE') {
        if (!move.isWait) {
          const dx = move.toX - r.x;
          const dy = move.toY - r.y;
          r.x = move.toX;
          r.y = move.toY;
          r.heading = Math.atan2(dy, dx);
          r.totalMoves++;
        }
        continue;
      }

      if (move.isWait) {
        r.waitTicks++;
        r.totalWaitTicks++;
        if (r.waitTicks === 2) {
          this.emitEvent(
            'ROBOT_WAITING',
            r.id,
            `${r.id} holding at (${r.x},${r.y}) for traffic clearance`
          );
        }
      } else {
        const dx = move.toX - r.x;
        const dy = move.toY - r.y;
        r.x = move.toX;
        r.y = move.toY;
        r.heading = Math.atan2(dy, dx);
        r.pathStepIndex = move.nextStepIndex;
        r.waitTicks = 0;
        r.totalMoves++;
        r.battery = Math.max(12, +(r.battery - 0.04).toFixed(2));
      }

      // Update carried package lastKnownPos
      if (r.carryingPackageId) {
        const pkg = this.packages.find((p) => p.id === r.carryingPackageId);
        if (pkg) pkg.lastKnownPos = { x: r.x, y: r.y };
      }

      // Recharge lightly when sitting on a charging bay
      if (this.warehouse.grid[r.y][r.x] === 'CHARGING') {
        r.battery = Math.min(100, +(r.battery + 1.5).toFixed(1));
      }
    }

    // 5. Process Arrival Milestones (Pickup, Recovery Handoff, Delivery)
    for (const r of this.robots) {
      if (r.status === 'FAILED' || !r.jobId) continue;
      const job = this.jobs.find((j) => j.id === r.jobId);
      const pkg = job
        ? this.packages.find((p) => p.id === job.packageId)
        : undefined;
      if (!job || !pkg) continue;

      // 5a. Arrival at Pickup
      if (
        r.status === 'MOVING_TO_PICKUP' &&
        sameCoord({ x: r.x, y: r.y }, job.pickup)
      ) {
        const ok = pickupPackageTransaction(pkg, r, this.robots, this.tick);
        if (ok) {
          job.status = 'IN_PROGRESS';
          r.status = 'CARRYING_TO_DROP';
          this.planPathForRobot(r, job.drop);
          this.emitEvent(
            'PACKAGE_PICKED_UP',
            pkg.id,
            `${r.id} picked up ${pkg.id} at (${r.x},${r.y}); routing to (${job.drop.x},${job.drop.y})`
          );
        }
      }
      // 5b. Arrival adjacent to Failed Robot for Package Recovery Transfer
      else if (r.status === 'RECOVERING_PACKAGE') {
        const failedRobot = this.robots.find(
          (fr) => fr.id === pkg.carrierRobotId
        );
        if (
          failedRobot &&
          manhattan({ x: r.x, y: r.y }, { x: failedRobot.x, y: failedRobot.y }) <=
            1
        ) {
          const ok = transferPackageTransaction(
            pkg,
            failedRobot,
            r,
            this.robots,
            this.tick
          );
          if (ok) {
            r.status = 'CARRYING_TO_DROP';
            r.recoveryTargetRobotId = null;
            this.planPathForRobot(r, job.drop);
            this.emitEvent(
              'PACKAGE_TRANSFERRED',
              pkg.id,
              `Custody of ${pkg.id} transferred ${failedRobot.id} -> ${r.id}`
            );
          }
        }
      }
      // 5c. Arrival at Drop Station
      else if (
        r.status === 'CARRYING_TO_DROP' &&
        sameCoord({ x: r.x, y: r.y }, job.drop)
      ) {
        const ok = deliverPackageTransaction(pkg, r, this.tick);
        if (ok) {
          job.status = 'COMPLETED';
          job.completedAtTick = this.tick;
          r.status = 'IDLE';
          r.jobId = null;
          r.path = null;
          r.pathStepIndex = 0;
          this.emitEvent(
            'PACKAGE_DELIVERED',
            pkg.id,
            `${r.id} delivered ${pkg.id} (${job.id}) in ${this.tick - job.createdAtTick} ticks`
          );
        }
      }
    }

    this.recordMetricsSnapshot();
  }

  private recordMetricsSnapshot(): void {
    const completed = this.jobs.filter((j) => j.status === 'COMPLETED');
    const pending = this.jobs.filter((j) => j.status !== 'COMPLETED');
    const activeRobots = this.robots.filter(
      (r) => r.status !== 'IDLE' && r.status !== 'FAILED'
    );
    const waitingRobots = this.robots.filter(
      (r) => r.status !== 'FAILED' && r.status !== 'IDLE' && r.waitTicks > 0
    );
    const failedRobots = this.robots.filter((r) => r.status === 'FAILED');

    const totalWait = this.robots.reduce((s, r) => s + r.totalWaitTicks, 0);
    const avgWaitTicks =
      this.robots.length > 0 ? +(totalWait / this.robots.length).toFixed(1) : 0;

    const avgDeliveryTicks =
      completed.length > 0
        ? +(
            completed.reduce(
              (s, j) => s + ((j.completedAtTick ?? this.tick) - j.createdAtTick),
              0
            ) / completed.length
          ).toFixed(1)
        : 0;

    const congestionIndex =
      activeRobots.length > 0
        ? Math.min(
            100,
            Math.round((waitingRobots.length / activeRobots.length) * 100)
          )
        : 0;

    const snapshot: TickMetricSnapshot = {
      tick: this.tick,
      completedJobs: completed.length,
      pendingJobs: pending.length,
      activeRobots: activeRobots.length,
      waitingRobots: waitingRobots.length,
      failedRobots: failedRobots.length,
      congestionIndex,
      avgWaitTicks,
      avgDeliveryTicks,
      replanCount: this.replanCount,
      deadlockCount: this.deadlockCount,
    };

    this.metricsHistory.push(snapshot);
    if (this.metricsHistory.length > 120) {
      this.metricsHistory.shift();
    }
  }

  // ==================== HACKATHON PS SCENARIO TRIGGERS ====================

  /**
   * Scenario 1: Narrow-Passage Conflict Demo
   * Forces two robots into opposing directions across the 1-cell North Express Tunnel.
   */
  public triggerNarrowPassageDemo(): void {
    this.reset('narrow_hub');
    this.jobMode = 'MANUAL';
    this.autoJobsPlaying = false;
    this.jobs = [];
    this.packages = [];

    // Position R01 on left entrance of P-NORTH (4,1) and R02 on right entrance (11,1)
    this.robots[0].x = 4;
    this.robots[0].y = 1;
    this.robots[0].prevX = 4;
    this.robots[0].prevY = 1;
    this.robots[0].priority = 4;

    this.robots[1].x = 11;
    this.robots[1].y = 1;
    this.robots[1].prevX = 11;
    this.robots[1].prevY = 1;
    this.robots[1].priority = 2;

    // Give R01 pickup at (4,1) -> drop at (12,0) (eastbound through P-NORTH)
    // Give R02 pickup at (11,1) -> drop at (3,0) (westbound through P-NORTH)
    const j1 = this.createJob({ x: 4, y: 1 }, { x: 12, y: 0 }, 3);
    const j2 = this.createJob({ x: 11, y: 1 }, { x: 3, y: 0 }, 2);

    this.robots[0].status = 'MOVING_TO_PICKUP';
    this.robots[0].jobId = j1.id;
    j1.assignedRobotId = this.robots[0].id;
    j1.status = 'ASSIGNED';
    this.planPathForRobot(this.robots[0], j1.pickup);

    this.robots[1].status = 'MOVING_TO_PICKUP';
    this.robots[1].jobId = j2.id;
    j2.assignedRobotId = this.robots[1].id;
    j2.status = 'ASSIGNED';
    this.planPathForRobot(this.robots[1], j2.pickup);

    this.emitEvent(
      'AISLE_RESERVED',
      'DEMO-1',
      'Scenario loaded: Narrow-Aisle Head-On Conflict (R01 vs R02)'
    );
    this.running = true;
  }

  /**
   * Scenario 2: Robot Failure & Transactional Package Recovery Demo
   */
  public triggerFailureRecoveryDemo(): void {
    // If an active robot is already carrying a package, fail it live!
    const carrying = this.robots.find(
      (r) => r.status === 'CARRYING_TO_DROP' && r.carryingPackageId !== null
    );
    if (carrying) {
      this.failRobot(carrying.id);
      this.running = true;
      return;
    }

    // Otherwise set up a clean mid-aisle carrying robot and fail it right away
    this.reset('narrow_hub');
    const rFail = this.robots[0];
    rFail.x = 7;
    rFail.y = 4;
    rFail.prevX = 6;
    rFail.prevY = 4;

    const job = this.createJob({ x: 3, y: 0 }, { x: 12, y: 10 }, 3);
    const pkg = this.packages.find((p) => p.id === job.packageId)!;
    job.assignedRobotId = rFail.id;
    job.startedAtTick = this.tick;
    job.status = 'IN_PROGRESS';
    rFail.jobId = job.id;
    rFail.status = 'CARRYING_TO_DROP';
    pickupPackageTransaction(pkg, rFail, this.robots, this.tick);

    this.failRobot(rFail.id);
    this.running = true;
  }

  /**
   * Scenario 3: Dynamic Aisle Blockage & Smoothed Rerouting Demo
   */
  public triggerDynamicBlockageDemo(): void {
    const activeRobot = this.robots.find(
      (r) =>
        r.status !== 'FAILED' &&
        r.status !== 'IDLE' &&
        r.path &&
        r.pathStepIndex + 2 < r.path.rawSteps.length
    );

    if (activeRobot && activeRobot.path) {
      const lookaheadStep =
        activeRobot.path.rawSteps[activeRobot.pathStepIndex + 2];
      const check = canToggleDynamicBlock(
        this.warehouse,
        lookaheadStep.x,
        lookaheadStep.y
      );
      if (check.allowed) {
        this.toggleDynamicBlock(
          lookaheadStep.x,
          lookaheadStep.y,
          'SCENARIO',
          'Temp Forklift Crossing (15T)',
          { delayTicks: 1, durationTicks: 15 }
        );
        this.running = true;
        return;
      }
    }

    // Fallback: block central corridor cells temporarily for 15 ticks and run
    this.toggleDynamicBlock(7, 4, 'SCENARIO', 'Temp Spill (15T)', {
      delayTicks: 0,
      durationTicks: 15,
    });
    this.toggleDynamicBlock(8, 4, 'SCENARIO', 'Temp Spill (15T)', {
      delayTicks: 0,
      durationTicks: 15,
    });
    this.running = true;
  }

  public getSnapshot(): SimulationStateSnapshot {
    const latestMetrics =
      this.metricsHistory[this.metricsHistory.length - 1] ?? {
        tick: this.tick,
        completedJobs: 0,
        pendingJobs: 0,
        activeRobots: 0,
        waitingRobots: 0,
        failedRobots: 0,
        congestionIndex: 0,
        avgWaitTicks: 0,
        avgDeliveryTicks: 0,
        replanCount: 0,
        deadlockCount: 0,
      };

    return {
      tick: this.tick,
      running: this.running,
      speedMultiplier: this.speedMultiplier,
      baseTickMs: this.baseTickMs,
      allocationStrategy: this.allocationStrategy,
      jobMode: this.jobMode,
      autoJobsPlaying: this.autoJobsPlaying,
      smoothingMode: this.smoothingMode,
      smoothingTension: this.smoothingTension,
      warehouse: cloneWarehouse(this.warehouse),
      robots: this.robots.map((r) => ({ ...r })),
      jobs: this.jobs.map((j) => ({ ...j })),
      packages: this.packages.map((p) => ({
        ...p,
        custodyHistory: [...p.custodyHistory],
      })),
      reservations: [...this.reservations],
      waitEdges: [...this.waitEdges],
      events: [...this.events],
      metricsHistory: [...this.metricsHistory],
      latestMetrics,
    };
  }
}
