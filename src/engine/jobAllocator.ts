import {
  AllocationStrategy,
  GridCoord,
  Job,
  PackageRecord,
  Robot,
  WarehouseLayout,
} from './types';
import { findSpatialPath } from './pathPlanner';
import { coordKey, manhattan } from './warehouseManager';

export interface AssignmentPair {
  robotId: string;
  jobId: string;
  isRecovery: boolean;
  targetCoord: GridCoord;
  estimatedCost: number;
}

/**
 * Hungarian (Munkres) O(n^3) minimum-cost bipartite matching for rectangular cost matrix.
 * Rows = available robots, Cols = candidate jobs.
 */
function hungarianSolve(costMatrix: number[][]): number[] {
  const n = costMatrix.length;
  const m = costMatrix[0]?.length ?? 0;
  if (n === 0 || m === 0) return [];

  const dim = Math.max(n, m);
  const INF = 1e9;
  const a: number[][] = Array.from({ length: dim + 1 }, () =>
    Array(dim + 1).fill(0)
  );

  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      if (i < n && j < m) {
        a[i + 1][j + 1] = costMatrix[i][j];
      } else {
        a[i + 1][j + 1] = 1e5; // dummy pad cost
      }
    }
  }

  const u = Array(dim + 1).fill(0);
  const v = Array(dim + 1).fill(0);
  const p = Array(dim + 1).fill(0);
  const way = Array(dim + 1).fill(0);

  for (let i = 1; i <= dim; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(dim + 1).fill(INF);
    const used = Array(dim + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= dim; j++) {
        if (!used[j]) {
          const cur = a[i0][j] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      }
      for (let j = 0; j <= dim; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const result = Array(n).fill(-1);
  for (let j = 1; j <= dim; j++) {
    if (p[j] > 0 && p[j] <= n && j <= m) {
      result[p[j] - 1] = j - 1;
    }
  }
  return result;
}

/**
 * Computes optimal or greedy robot-to-job assignments for IDLE robots.
 * Recovery jobs (stranded packages on failed robots) receive a high priority discount
 * so stranded cargo is recovered quickly.
 */
export function allocateJobs(
  robots: Robot[],
  jobs: Job[],
  packages: PackageRecord[],
  warehouse: WarehouseLayout,
  strategy: AllocationStrategy,
  currentTick: number
): AssignmentPair[] {
  const idleRobots = robots.filter(
    (r) =>
      r.status === 'IDLE' &&
      r.jobId === null &&
      r.carryingPackageId === null &&
      r.battery > 8
  );
  if (idleRobots.length === 0) return [];

  const candidateJobs = jobs.filter(
    (j) =>
      (j.status === 'PENDING' || j.status === 'RECOVERY_PENDING') &&
      j.assignedRobotId === null
  );
  if (candidateJobs.length === 0) return [];

  const failedCells = new Set<string>(
    robots.filter((r) => r.status === 'FAILED').map((r) => coordKey(r.x, r.y))
  );

  const pkgMap = new Map(packages.map((p) => [p.id, p]));

  // Determine actual target coordinate for each candidate job
  const jobTargets: { job: Job; target: GridCoord; isRecovery: boolean }[] = [];
  for (const job of candidateJobs) {
    const pkg = pkgMap.get(job.packageId);
    if (job.status === 'RECOVERY_PENDING' && pkg && pkg.carrierRobotId) {
      // Find an open adjacent cell next to the failed robot to perform custody transfer
      const failedPos = pkg.lastKnownPos;
      const neighbors = [
        { x: failedPos.x + 1, y: failedPos.y },
        { x: failedPos.x - 1, y: failedPos.y },
        { x: failedPos.x, y: failedPos.y + 1 },
        { x: failedPos.x, y: failedPos.y - 1 },
      ];
      // Choose closest reachable adjacent cell (or fallback to failedPos if needed)
      let chosen: GridCoord | null = null;
      for (const nb of neighbors) {
        if (
          nb.x >= 0 &&
          nb.y >= 0 &&
          nb.x < warehouse.cols &&
          nb.y < warehouse.rows &&
          warehouse.grid[nb.y][nb.x] !== 'SHELF' &&
          !warehouse.dynamicObstacles.has(coordKey(nb.x, nb.y)) &&
          !failedCells.has(coordKey(nb.x, nb.y))
        ) {
          chosen = nb;
          break;
        }
      }
      if (chosen) {
        jobTargets.push({ job, target: chosen, isRecovery: true });
      }
    } else {
      jobTargets.push({ job, target: job.pickup, isRecovery: false });
    }
  }

  if (jobTargets.length === 0) return [];

  const costMatrix: number[][] = idleRobots.map((robot) =>
    jobTargets.map(({ job, target, isRecovery }) => {
      const path = findSpatialPath(
        warehouse,
        { x: robot.x, y: robot.y },
        target,
        failedCells
      );
      if (!path) return 99999;
      const ageBonus = Math.min(12, (currentTick - job.createdAtTick) * 0.15);
      const recoveryDiscount = isRecovery ? 8 : 0;
      const priorityBonus = job.priority * 2;
      const batteryPenalty = robot.battery < 25 ? 6 : 0;
      return Math.max(
        1,
        path.length - 1 + batteryPenalty - ageBonus - recoveryDiscount - priorityBonus
      );
    })
  );

  const pairs: AssignmentPair[] = [];

  if (strategy === 'HUNGARIAN') {
    const assignment = hungarianSolve(costMatrix);
    for (let i = 0; i < assignment.length; i++) {
      const jIdx = assignment[i];
      if (jIdx !== -1 && costMatrix[i][jIdx] < 50000) {
        pairs.push({
          robotId: idleRobots[i].id,
          jobId: jobTargets[jIdx].job.id,
          isRecovery: jobTargets[jIdx].isRecovery,
          targetCoord: jobTargets[jIdx].target,
          estimatedCost: costMatrix[i][jIdx],
        });
      }
    }
  } else {
    // Greedy nearest-robot assignment
    const usedRobots = new Set<number>();
    const usedJobs = new Set<number>();
    const candidates: { rIdx: number; jIdx: number; cost: number }[] = [];
    for (let r = 0; r < idleRobots.length; r++) {
      for (let j = 0; j < jobTargets.length; j++) {
        if (costMatrix[r][j] < 50000) {
          candidates.push({ rIdx: r, jIdx: j, cost: costMatrix[r][j] });
        }
      }
    }
    candidates.sort((a, b) => a.cost - b.cost);
    for (const c of candidates) {
      if (!usedRobots.has(c.rIdx) && !usedJobs.has(c.jIdx)) {
        usedRobots.add(c.rIdx);
        usedJobs.add(c.jIdx);
        pairs.push({
          robotId: idleRobots[c.rIdx].id,
          jobId: jobTargets[c.jIdx].job.id,
          isRecovery: jobTargets[c.jIdx].isRecovery,
          targetCoord: jobTargets[c.jIdx].target,
          estimatedCost: c.cost,
        });
      }
    }
  }

  return pairs;
}

/**
 * Helper to pick the best reachable adjacent handoff cell to a failed robot
 * for a specific recovering robot.
 */
export function findBestHandoffCell(
  warehouse: WarehouseLayout,
  robotPos: GridCoord,
  failedPos: GridCoord,
  failedCells: Set<string>
): GridCoord | null {
  const neighbors = [
    { x: failedPos.x + 1, y: failedPos.y },
    { x: failedPos.x - 1, y: failedPos.y },
    { x: failedPos.x, y: failedPos.y + 1 },
    { x: failedPos.x, y: failedPos.y - 1 },
  ];
  let best: GridCoord | null = null;
  let bestDist = Infinity;
  for (const nb of neighbors) {
    if (
      nb.x >= 0 &&
      nb.y >= 0 &&
      nb.x < warehouse.cols &&
      nb.y < warehouse.rows &&
      warehouse.grid[nb.y][nb.x] !== 'SHELF' &&
      !warehouse.dynamicObstacles.has(coordKey(nb.x, nb.y)) &&
      !failedCells.has(coordKey(nb.x, nb.y))
    ) {
      const d = manhattan(robotPos, nb);
      if (d < bestDist) {
        bestDist = d;
        best = nb;
      }
    }
  }
  return best;
}
