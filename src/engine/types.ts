export interface GridCoord {
  x: number;
  y: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export type CellType =
  | 'FLOOR'
  | 'SHELF'
  | 'PICKUP'
  | 'DROP'
  | 'CHARGING'
  | 'NARROW_AISLE';

export interface DynamicObstacle {
  x: number;
  y: number;
  status: 'BLOCKED';
  startTick: number;
  endTick: number | null; // null = permanent/infinite until manually unblocked
  durationTicks: number | null;
  reason: string;
  blockedAtTick: number;
  source: 'USER' | 'SCENARIO';
}

export interface NarrowPassage {
  id: string;
  name: string;
  cells: GridCoord[];
  lockedByRobotId: string | null;
  lockedDirection: number; // +1 forward index, -1 backward index, 0 unlocked
  lockAcquiredTick: number;
}

export interface WarehouseLayout {
  id: string;
  name: string;
  description: string;
  cols: number;
  rows: number;
  grid: CellType[][];
  pickupStations: { id: string; label: string; coord: GridCoord }[];
  dropStations: { id: string; label: string; coord: GridCoord }[];
  chargingBays: GridCoord[];
  passages: NarrowPassage[];
  dynamicObstacles: Map<string, DynamicObstacle>;
}

export type SmoothingMode = 'CATMULL_ROM' | 'CHAIKIN' | 'RAW';

export interface SpaceTimeStep {
  x: number;
  y: number;
  tick: number;
}

export interface SplinePoint {
  x: number;
  y: number;
  stepIndex: number;
  arcFraction: number; // 0..1 along entire trajectory
}

export interface SmoothedTrajectory {
  mode: SmoothingMode;
  tension: number;
  rawSteps: SpaceTimeStep[];
  controlPoints: Point2D[];
  splinePoints: SplinePoint[];
  /** Lookup: for each discrete step index `i`, start/end index inside `splinePoints` */
  stepToSplineRange: { start: number; end: number }[];
  totalArcLength: number;
  rawManhattanLength: number;
}

export type RobotStatus =
  | 'IDLE'
  | 'MOVING_TO_PICKUP'
  | 'CARRYING_TO_DROP'
  | 'WAITING'
  | 'RECOVERING_PACKAGE'
  | 'FAILED';

export interface Robot {
  id: string;
  name: string;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  heading: number; // radians
  status: RobotStatus;
  battery: number;
  jobId: string | null;
  carryingPackageId: string | null;
  recoveryTargetRobotId: string | null;
  path: SmoothedTrajectory | null;
  pathStepIndex: number;
  waitTicks: number;
  totalWaitTicks: number;
  totalMoves: number;
  priority: number;
  lastReplanTick: number;
  color: string;
  blockedWarningTick: number | null;
}

export type PackageStatus =
  | 'AT_PICKUP'
  | 'IN_TRANSIT'
  | 'STRANDED'
  | 'RECOVERING'
  | 'DELIVERED';

export interface CustodyEvent {
  tick: number;
  fromRobotId: string | null;
  toRobotId: string | null;
  action: string;
}

export interface PackageRecord {
  id: string;
  jobId: string;
  label: string;
  status: PackageStatus;
  carrierRobotId: string | null;
  lastKnownPos: GridCoord;
  custodyHistory: CustodyEvent[];
}

export type JobStatus =
  | 'PENDING'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'RECOVERY_PENDING'
  | 'COMPLETED';

export interface Job {
  id: string;
  packageId: string;
  packageLabel: string;
  pickup: GridCoord;
  drop: GridCoord;
  priority: number;
  status: JobStatus;
  assignedRobotId: string | null;
  createdAtTick: number;
  startedAtTick: number | null;
  completedAtTick: number | null;
}

export interface ReservationEntry {
  robotId: string;
  x: number;
  y: number;
  tick: number;
  kind: 'CELL' | 'EDGE';
  fromX?: number;
  fromY?: number;
}

export interface WaitEdge {
  waitingRobotId: string;
  blockingRobotId: string;
  targetCell: GridCoord;
  inCycle: boolean;
}

export type ArenaEventType =
  | 'JOB_CREATED'
  | 'ROBOT_ASSIGNED'
  | 'PACKAGE_PICKED_UP'
  | 'AISLE_RESERVED'
  | 'AISLE_RELEASED'
  | 'OBSTACLE_BLOCKED'
  | 'OBSTACLE_UNBLOCKED'
  | 'PATH_RECALCULATED'
  | 'ROBOT_WAITING'
  | 'DEADLOCK_DETECTED'
  | 'DEADLOCK_RESOLVED'
  | 'ROBOT_FAILED'
  | 'ROBOT_REPAIRED'
  | 'PACKAGE_RECOVERY_STARTED'
  | 'PACKAGE_TRANSFERRED'
  | 'PACKAGE_DELIVERED';

export interface ArenaEvent {
  id: string;
  tick: number;
  timestamp: string;
  type: ArenaEventType;
  entityId: string;
  message: string;
}

export interface TickMetricSnapshot {
  tick: number;
  completedJobs: number;
  pendingJobs: number;
  activeRobots: number;
  waitingRobots: number;
  failedRobots: number;
  congestionIndex: number; // 0..100 %
  avgWaitTicks: number;
  avgDeliveryTicks: number;
  replanCount: number;
  deadlockCount: number;
}

export type AllocationStrategy = 'HUNGARIAN' | 'GREEDY';

export type JobGenerationMode = 'AUTO' | 'MANUAL';

export type InteractionTool = 'BLOCK_CELL' | 'INSPECT_ROBOT' | 'DISPATCH_PICKUP';

export interface LayerVisibility {
  smoothedPaths: boolean;
  rawGridPaths: boolean;
  splineControlPoints: boolean;
  reservations: boolean;
  waitForGraph: boolean;
  narrowPassages: boolean;
}

export interface SimulationStateSnapshot {
  tick: number;
  running: boolean;
  speedMultiplier: number;
  baseTickMs: number;
  allocationStrategy: AllocationStrategy;
  jobMode: JobGenerationMode;
  autoJobsPlaying: boolean;
  smoothingMode: SmoothingMode;
  smoothingTension: number;
  warehouse: WarehouseLayout;
  robots: Robot[];
  jobs: Job[];
  packages: PackageRecord[];
  reservations: ReservationEntry[];
  waitEdges: WaitEdge[];
  events: ArenaEvent[];
  metricsHistory: TickMetricSnapshot[];
  latestMetrics: TickMetricSnapshot;
}
