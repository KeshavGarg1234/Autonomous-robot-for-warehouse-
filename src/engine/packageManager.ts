import { PackageRecord, Robot } from './types';

/**
 * Enforces strict unique-carrier custody invariants:
 *  - A package may never have two simultaneous carriers.
 *  - A failed robot retains physical custody of its carried package until an explicit
 *    recovery transfer transaction occurs.
 */
export function pickupPackageTransaction(
  pkg: PackageRecord,
  robot: Robot,
  robots: Robot[],
  tick: number
): boolean {
  if (pkg.status !== 'AT_PICKUP' || pkg.carrierRobotId !== null) {
    return false;
  }
  if (robot.carryingPackageId !== null) {
    return false;
  }
  // Verify no other robot claims this package
  const duplicateCarrier = robots.find((r) => r.carryingPackageId === pkg.id);
  if (duplicateCarrier) {
    return false;
  }

  pkg.status = 'IN_TRANSIT';
  pkg.carrierRobotId = robot.id;
  pkg.lastKnownPos = { x: robot.x, y: robot.y };
  pkg.custodyHistory.push({
    tick,
    fromRobotId: null,
    toRobotId: robot.id,
    action: 'PICKED_UP',
  });

  robot.carryingPackageId = pkg.id;
  return true;
}

export function markPackageStrandedOnFailure(
  pkg: PackageRecord,
  failedRobot: Robot,
  tick: number
): void {
  // Failed robot RETAINS carrierRobotId custody until recovery transfer!
  pkg.status = 'STRANDED';
  pkg.lastKnownPos = { x: failedRobot.x, y: failedRobot.y };
  pkg.custodyHistory.push({
    tick,
    fromRobotId: failedRobot.id,
    toRobotId: failedRobot.id,
    action: 'STRANDED_ON_FAILURE',
  });
}

export function transferPackageTransaction(
  pkg: PackageRecord,
  fromFailedRobot: Robot,
  toRecoveryRobot: Robot,
  robots: Robot[],
  tick: number
): boolean {
  if (pkg.carrierRobotId !== fromFailedRobot.id) return false;
  if (toRecoveryRobot.carryingPackageId !== null) return false;
  if (toRecoveryRobot.status === 'FAILED') return false;

  // Atomic custody swap: clear old carrier and assign new carrier in one transaction
  const otherClaim = robots.find(
    (r) => r.id !== fromFailedRobot.id && r.carryingPackageId === pkg.id
  );
  if (otherClaim) return false;

  fromFailedRobot.carryingPackageId = null;
  toRecoveryRobot.carryingPackageId = pkg.id;

  pkg.carrierRobotId = toRecoveryRobot.id;
  pkg.status = 'IN_TRANSIT';
  pkg.lastKnownPos = { x: toRecoveryRobot.x, y: toRecoveryRobot.y };
  pkg.custodyHistory.push({
    tick,
    fromRobotId: fromFailedRobot.id,
    toRobotId: toRecoveryRobot.id,
    action: 'RECOVERY_TRANSFER',
  });

  return true;
}

export function deliverPackageTransaction(
  pkg: PackageRecord,
  robot: Robot,
  tick: number
): boolean {
  if (pkg.carrierRobotId !== robot.id || robot.carryingPackageId !== pkg.id) {
    return false;
  }

  robot.carryingPackageId = null;
  pkg.carrierRobotId = null;
  pkg.status = 'DELIVERED';
  pkg.lastKnownPos = { x: robot.x, y: robot.y };
  pkg.custodyHistory.push({
    tick,
    fromRobotId: robot.id,
    toRobotId: null,
    action: 'DELIVERED',
  });

  return true;
}

/**
 * Runtime audit helper verifying the unique-carrier invariant across all packages and robots.
 */
export function verifyUniqueCarrierInvariant(
  packages: PackageRecord[],
  robots: Robot[]
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  const carrierCount = new Map<string, number>();

  for (const r of robots) {
    if (r.carryingPackageId) {
      carrierCount.set(
        r.carryingPackageId,
        (carrierCount.get(r.carryingPackageId) ?? 0) + 1
      );
    }
  }

  for (const pkg of packages) {
    const count = carrierCount.get(pkg.id) ?? 0;
    if (count > 1) {
      violations.push(`Package ${pkg.id} claimed by ${count} robots`);
    }
    if (pkg.status === 'DELIVERED' && pkg.carrierRobotId !== null) {
      violations.push(`Delivered package ${pkg.id} still lists carrier`);
    }
    if (
      (pkg.status === 'IN_TRANSIT' || pkg.status === 'STRANDED') &&
      !pkg.carrierRobotId
    ) {
      violations.push(`Package ${pkg.id} (${pkg.status}) missing carrier`);
    }
  }

  return { valid: violations.length === 0, violations };
}
