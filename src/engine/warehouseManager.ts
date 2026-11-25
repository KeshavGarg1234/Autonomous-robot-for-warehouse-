import {
  CellType,
  DynamicObstacle,
  GridCoord,
  NarrowPassage,
  WarehouseLayout,
} from './types';

export function coordKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function sameCoord(a: GridCoord, b: GridCoord): boolean {
  return a.x === b.x && a.y === b.y;
}

export function manhattan(a: GridCoord, b: GridCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export type WarehousePresetId = 'narrow_hub' | 'cross_dock' | 'dense_matrix';

interface PresetSpec {
  id: WarehousePresetId;
  name: string;
  description: string;
  ascii: string[];
  passages: { id: string; name: string; cells: GridCoord[] }[];
}

/**
 * Legend:
 *  . = FLOOR
 *  # = SHELF (static obstacle)
 *  P = PICKUP station
 *  D = DROP station
 *  C = CHARGING bay
 *  = = NARROW_AISLE (1-cell-wide shared corridor)
 */
const PRESETS: Record<WarehousePresetId, PresetSpec> = {
  narrow_hub: {
    id: 'narrow_hub',
    name: 'Narrow-Aisle Fulfillment Hub',
    description:
      'Dual 1-cell narrow corridors with central passing alcoves, ideal for testing passage locking, deadlock recovery, and obstacle rerouting.',
    ascii: [
      'C..P........D..C',
      '.###.======.###.',
      'P..#........#..D',
      '.#.#.######.#.#.',
      '.#............#.',
      'P..###.==.###..D',
      '.#............#.',
      '.#.###.##.###.#.',
      '.#.....==.....#.',
      '.###.======.###.',
      'C..P........D..C',
    ],
    passages: [
      {
        id: 'P-NORTH',
        name: 'North Express Tunnel',
        cells: [
          { x: 5, y: 1 },
          { x: 6, y: 1 },
          { x: 7, y: 1 },
          { x: 8, y: 1 },
          { x: 9, y: 1 },
          { x: 10, y: 1 },
        ],
      },
      {
        id: 'P-MID',
        name: 'Central Throat',
        cells: [
          { x: 7, y: 5 },
          { x: 8, y: 5 },
        ],
      },
      {
        id: 'P-SOUTH',
        name: 'South Express Tunnel',
        cells: [
          { x: 5, y: 9 },
          { x: 6, y: 9 },
          { x: 7, y: 9 },
          { x: 8, y: 9 },
          { x: 9, y: 9 },
          { x: 10, y: 9 },
        ],
      },
    ],
  },
  cross_dock: {
    id: 'cross_dock',
    name: 'Cross-Dock Chokepoint Arena',
    description:
      'Symmetrical 4-quadrant shelf layout converging through narrow cross-aisles and central interchange.',
    ascii: [
      'P...#......#...D',
      '.##.#.====.#.##.',
      '.##..........##.',
      'P...###..###...D',
      '.==..........==.',
      '....##....##....',
      '.==..........==.',
      'P...###..###...D',
      '.##..........##.',
      '.##.#.====.#.##.',
      'C...#......#...C',
    ],
    passages: [
      {
        id: 'P-TOP',
        name: 'North Cross-Aisle',
        cells: [
          { x: 6, y: 1 },
          { x: 7, y: 1 },
          { x: 8, y: 1 },
          { x: 9, y: 1 },
        ],
      },
      {
        id: 'P-BOT',
        name: 'South Cross-Aisle',
        cells: [
          { x: 6, y: 9 },
          { x: 7, y: 9 },
          { x: 8, y: 9 },
          { x: 9, y: 9 },
        ],
      },
    ],
  },
  dense_matrix: {
    id: 'dense_matrix',
    name: 'High-Density Fulfillment Grid',
    description:
      '18x12 high-throughput picking matrix with multiple shelf bays, narrow lanes, and 6 robot bays.',
    ascii: [
      'C..P....D....P...C',
      '.##.##.====.##.##.',
      '.##.##......##.##.',
      'P......####......D',
      '.==.##......##.==.',
      '....##.====.##....',
      '....##......##....',
      '.==.##.====.##.==.',
      'P......####......D',
      '.##.##......##.##.',
      '.##.##.====.##.##.',
      'C..D....P....D...C',
    ],
    passages: [
      {
        id: 'P-N1',
        name: 'Upper Spine',
        cells: [
          { x: 7, y: 1 },
          { x: 8, y: 1 },
          { x: 9, y: 1 },
          { x: 10, y: 1 },
        ],
      },
      {
        id: 'P-C1',
        name: 'Mid Spine',
        cells: [
          { x: 7, y: 5 },
          { x: 8, y: 5 },
          { x: 9, y: 5 },
          { x: 10, y: 5 },
        ],
      },
      {
        id: 'P-S1',
        name: 'Lower Spine',
        cells: [
          { x: 7, y: 10 },
          { x: 8, y: 10 },
          { x: 9, y: 10 },
          { x: 10, y: 10 },
        ],
      },
    ],
  },
};

export function getWarehousePresets(): {
  id: WarehousePresetId;
  name: string;
  description: string;
}[] {
  return Object.values(PRESETS).map(({ id, name, description }) => ({
    id,
    name,
    description,
  }));
}

export function createWarehouseLayout(
  presetId: WarehousePresetId = 'narrow_hub'
): WarehouseLayout {
  const spec = PRESETS[presetId];
  const rows = spec.ascii.length;
  const cols = spec.ascii[0].length;
  const grid: CellType[][] = [];
  const pickupStations: { id: string; label: string; coord: GridCoord }[] = [];
  const dropStations: { id: string; label: string; coord: GridCoord }[] = [];
  const chargingBays: GridCoord[] = [];

  for (let y = 0; y < rows; y++) {
    const row: CellType[] = [];
    for (let x = 0; x < cols; x++) {
      const ch = spec.ascii[y][x];
      switch (ch) {
        case '#':
          row.push('SHELF');
          break;
        case 'P':
          row.push('PICKUP');
          pickupStations.push({
            id: `PK-${pickupStations.length + 1}`,
            label: `Inbound ${String.fromCharCode(65 + pickupStations.length)}`,
            coord: { x, y },
          });
          break;
        case 'D':
          row.push('DROP');
          dropStations.push({
            id: `DR-${dropStations.length + 1}`,
            label: `Outbound ${dropStations.length + 1}`,
            coord: { x, y },
          });
          break;
        case 'C':
          row.push('CHARGING');
          chargingBays.push({ x, y });
          break;
        case '=':
          row.push('NARROW_AISLE');
          break;
        default:
          row.push('FLOOR');
          break;
      }
    }
    grid.push(row);
  }

  const passages: NarrowPassage[] = spec.passages.map((p) => ({
    id: p.id,
    name: p.name,
    cells: p.cells.map((c) => ({ ...c })),
    lockedByRobotId: null,
    lockedDirection: 0,
    lockAcquiredTick: 0,
  }));

  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    cols,
    rows,
    grid,
    pickupStations,
    dropStations,
    chargingBays,
    passages,
    dynamicObstacles: new Map<string, DynamicObstacle>(),
  };
}

export function isWithinBounds(
  warehouse: WarehouseLayout,
  x: number,
  y: number
): boolean {
  return x >= 0 && y >= 0 && x < warehouse.cols && y < warehouse.rows;
}

export function isCellWalkable(
  warehouse: WarehouseLayout,
  x: number,
  y: number
): boolean {
  if (!isWithinBounds(warehouse, x, y)) return false;
  if (warehouse.grid[y][x] === 'SHELF') return false;
  const obs = warehouse.dynamicObstacles.get(coordKey(x, y));
  if (obs && obs.status === 'BLOCKED' && obs.endTick === null) {
    return false;
  }
  return true;
}

/**
 * Time-dependent walkability check for Space-Time A* and discrete tick execution.
 * Returns true if the cell is walkable at `tick` (not a shelf, and not actively BLOCKED at `tick`).
 */
export function isCellBlockedAtTick(
  warehouse: WarehouseLayout,
  x: number,
  y: number,
  tick: number
): boolean {
  if (!isWithinBounds(warehouse, x, y)) return true;
  if (warehouse.grid[y][x] === 'SHELF') return true;
  const obs = warehouse.dynamicObstacles.get(coordKey(x, y));
  if (!obs || obs.status !== 'BLOCKED') return false;
  if (tick < obs.startTick) return false;
  if (obs.endTick !== null && tick >= obs.endTick) return false;
  return true;
}

export function isCellWalkableAtTick(
  warehouse: WarehouseLayout,
  x: number,
  y: number,
  tick: number
): boolean {
  return !isCellBlockedAtTick(warehouse, x, y, tick);
}

export function isDynamicBlocked(
  warehouse: WarehouseLayout,
  x: number,
  y: number,
  tick?: number
): boolean {
  const obs = warehouse.dynamicObstacles.get(coordKey(x, y));
  if (!obs || obs.status !== 'BLOCKED') return false;
  if (tick === undefined) return true;
  if (tick < obs.startTick) return false;
  if (obs.endTick !== null && tick >= obs.endTick) return false;
  return true;
}

export function canToggleDynamicBlock(
  warehouse: WarehouseLayout,
  x: number,
  y: number
): { allowed: boolean; reason?: string } {
  if (!isWithinBounds(warehouse, x, y)) {
    return { allowed: false, reason: 'Out of grid bounds' };
  }
  const type = warehouse.grid[y][x];
  if (type === 'SHELF') {
    return { allowed: false, reason: 'Static shelf cannot be toggled' };
  }
  if (type === 'PICKUP' || type === 'DROP') {
    return {
      allowed: false,
      reason: 'Pickup/Drop dock cells stay open for station access',
    };
  }
  return { allowed: true };
}

export function getPassageForCell(
  warehouse: WarehouseLayout,
  x: number,
  y: number
): { passage: NarrowPassage; cellIndex: number } | null {
  for (const passage of warehouse.passages) {
    const idx = passage.cells.findIndex((c) => c.x === x && c.y === y);
    if (idx !== -1) {
      return { passage, cellIndex: idx };
    }
  }
  return null;
}

export function cloneWarehouse(w: WarehouseLayout): WarehouseLayout {
  return {
    ...w,
    grid: w.grid.map((r) => [...r]),
    pickupStations: w.pickupStations.map((s) => ({ ...s, coord: { ...s.coord } })),
    dropStations: w.dropStations.map((s) => ({ ...s, coord: { ...s.coord } })),
    chargingBays: w.chargingBays.map((c) => ({ ...c })),
    passages: w.passages.map((p) => ({
      ...p,
      cells: p.cells.map((c) => ({ ...c })),
    })),
    dynamicObstacles: new Map(w.dynamicObstacles),
  };
}
