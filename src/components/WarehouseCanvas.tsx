import React, { useEffect, useRef, useState } from 'react';
import {
  GridCoord,
  InteractionTool,
  LayerVisibility,
  Robot,
  SimulationStateSnapshot,
} from '../engine/types';
import { coordKey } from '../engine/warehouseManager';

interface WarehouseCanvasProps {
  snapshot: SimulationStateSnapshot;
  tickTimestampRef: React.MutableRefObject<number>;
  tool: InteractionTool;
  layers: LayerVisibility;
  selectedRobotId: string | null;
  pendingPickupCoord: GridCoord | null;
  onCellClick: (x: number, y: number) => void;
  onSelectRobot: (robotId: string | null) => void;
}

function getInterpolatedRobotPose(
  robot: Robot,
  progress: number
): { px: number; py: number; heading: number } {
  const clamped = Math.max(0, Math.min(1, progress));
  const moved = robot.prevX !== robot.x || robot.prevY !== robot.y;

  if (!moved || robot.status === 'FAILED') {
    return {
      px: robot.x + 0.5,
      py: robot.y + 0.5,
      heading: robot.heading,
    };
  }

  // Follow the smoothed spline points for the step just executed
  if (robot.path && robot.pathStepIndex > 0) {
    const completedStepIdx = robot.pathStepIndex - 1;
    const range = robot.path.stepToSplineRange[completedStepIdx];
    const pts = robot.path.splinePoints;
    if (range && range.end > range.start && range.end < pts.length) {
      const span = range.end - range.start;
      const floatIdx = range.start + clamped * span;
      const idxA = Math.floor(floatIdx);
      const idxB = Math.min(range.end, idxA + 1);
      const localT = floatIdx - idxA;
      const pA = pts[idxA];
      const pB = pts[idxB];
      const px = pA.x + (pB.x - pA.x) * localT;
      const py = pA.y + (pB.y - pA.y) * localT;

      // Tangent heading along spline curve
      const lookBack = pts[Math.max(range.start, idxA - 1)];
      const lookAhead = pts[Math.min(range.end, idxB + 1)];
      const tx = lookAhead.x - lookBack.x;
      const ty = lookAhead.y - lookBack.y;
      const heading =
        Math.hypot(tx, ty) > 0.001 ? Math.atan2(ty, tx) : robot.heading;
      return { px, py, heading };
    }
  }

  const px = robot.prevX + 0.5 + (robot.x - robot.prevX) * clamped;
  const py = robot.prevY + 0.5 + (robot.y - robot.prevY) * clamped;
  return { px, py, heading: robot.heading };
}

export const WarehouseCanvas: React.FC<WarehouseCanvasProps> = ({
  snapshot,
  tickTimestampRef,
  tool,
  layers,
  selectedRobotId,
  pendingPickupCoord,
  onCellClick,
  onSelectRobot,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverCell, setHoverCell] = useState<GridCoord | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const selectedRobotRef = useRef(selectedRobotId);
  selectedRobotRef.current = selectedRobotId;
  const hoverCellRef = useRef(hoverCell);
  hoverCellRef.current = hoverCell;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const pendingPickupRef = useRef(pendingPickupCoord);
  pendingPickupRef.current = pendingPickupCoord;

  // Compute grid metrics cleanly for pointer hit-testing and rendering
  const getLayoutMetrics = (width: number, height: number) => {
    const { cols, rows } = snapshotRef.current.warehouse;
    const pad = 28;
    const availW = Math.max(100, width - pad * 2);
    const availH = Math.max(100, height - pad * 2);
    const cellSize = Math.floor(Math.min(availW / cols, availH / rows));
    const gridW = cellSize * cols;
    const gridH = cellSize * rows;
    const offsetX = Math.floor((width - gridW) / 2);
    const offsetY = Math.floor((height - gridH) / 2);
    return { cellSize, gridW, gridH, offsetX, offsetY, cols, rows };
  };

  useEffect(() => {
    let rafId = 0;

    const renderFrame = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) {
        rafId = requestAnimationFrame(renderFrame);
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      const cssW = Math.max(320, Math.floor(rect.width));
      const cssH = Math.max(260, Math.floor(rect.height));

      if (
        canvas.width !== Math.floor(cssW * dpr) ||
        canvas.height !== Math.floor(cssH * dpr)
      ) {
        canvas.width = Math.floor(cssW * dpr);
        canvas.height = Math.floor(cssH * dpr);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        rafId = requestAnimationFrame(renderFrame);
        return;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // Clear stage background
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, cssW, cssH);

      const snap = snapshotRef.current;
      const vis = layersRef.current;
      const { warehouse, robots, jobs, reservations, waitEdges } = snap;
      const { cellSize, gridW, gridH, offsetX, offsetY, cols, rows } =
        getLayoutMetrics(cssW, cssH);

      const tickDuration = snap.baseTickMs / Math.max(0.5, snap.speedMultiplier);
      const elapsed = performance.now() - tickTimestampRef.current;
      const progress = snap.running ? Math.min(1, elapsed / tickDuration) : 1;

      // 1. Draw Warehouse Floor Frame
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(offsetX, offsetY, gridW, gridH);

      // 2. Draw Cells
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const cx = offsetX + x * cellSize;
          const cy = offsetY + y * cellSize;
          const cell = warehouse.grid[y][x];
          const obstacle = warehouse.dynamicObstacles.get(coordKey(x, y));

          if (cell === 'SHELF') {
            ctx.fillStyle = '#1e293b';
            ctx.fillRect(cx + 1, cy + 1, cellSize - 2, cellSize - 2);
            // Subtle rack cross-slat detail
            ctx.strokeStyle = '#334155';
            ctx.lineWidth = 1;
            ctx.strokeRect(cx + 4, cy + 4, cellSize - 8, cellSize - 8);
          } else if (cell === 'NARROW_AISLE') {
            ctx.fillStyle = '#fef3c7';
            ctx.fillRect(cx, cy, cellSize, cellSize);
          } else if (cell === 'PICKUP') {
            ctx.fillStyle = '#e0f2fe';
            ctx.fillRect(cx, cy, cellSize, cellSize);
          } else if (cell === 'DROP') {
            ctx.fillStyle = '#dcfce7';
            ctx.fillRect(cx, cy, cellSize, cellSize);
          } else if (cell === 'CHARGING') {
            ctx.fillStyle = '#f1f5f9';
            ctx.fillRect(cx, cy, cellSize, cellSize);
          }

          // Dynamic Obstacle Hatching (active vs scheduled future window)
          if (obstacle) {
            const isFuture = snap.tick < obstacle.startTick;
            ctx.fillStyle = isFuture ? '#fef3c7' : '#fee2e2';
            ctx.fillRect(cx + 1, cy + 1, cellSize - 2, cellSize - 2);
            ctx.save();
            ctx.beginPath();
            ctx.rect(cx + 2, cy + 2, cellSize - 4, cellSize - 4);
            ctx.clip();
            ctx.strokeStyle = isFuture ? '#d97706' : '#dc2626';
            ctx.lineWidth = 2;
            for (let d = -cellSize; d < cellSize * 2; d += 8) {
              ctx.beginPath();
              ctx.moveTo(cx + d, cy);
              ctx.lineTo(cx + d + cellSize, cy + cellSize);
              ctx.stroke();
            }
            ctx.restore();
            ctx.strokeStyle = isFuture ? '#b45309' : '#b91c1c';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(cx + 1.5, cy + 1.5, cellSize - 3, cellSize - 3);

            // Render time window countdown on temporary / scheduled obstacles
            if (obstacle.endTick !== null || isFuture) {
              const label = isFuture
                ? `+${obstacle.startTick - snap.tick}T`
                : `${Math.max(0, (obstacle.endTick ?? snap.tick) - snap.tick)}T`;
              ctx.font = '600 9px "JetBrains Mono", monospace';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillStyle = 'rgba(255,255,255,0.92)';
              ctx.fillRect(cx + cellSize * 0.2, cy + cellSize * 0.3, cellSize * 0.6, cellSize * 0.4);
              ctx.fillStyle = isFuture ? '#92400e' : '#991b1b';
              ctx.fillText(label, cx + cellSize / 2, cy + cellSize / 2);
            }
          }

          // Grid Hairline
          ctx.strokeStyle = '#e2e8f0';
          ctx.lineWidth = 1;
          ctx.strokeRect(cx, cy, cellSize, cellSize);

          // Station Labels
          if (cell === 'PICKUP' || cell === 'DROP' || cell === 'CHARGING') {
            ctx.font = `600 ${Math.max(9, Math.floor(cellSize * 0.25))}px "JetBrains Mono", monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (cell === 'PICKUP') {
              ctx.fillStyle = '#0369a1';
              ctx.fillText('IN', cx + cellSize / 2, cy + cellSize / 2);
            } else if (cell === 'DROP') {
              ctx.fillStyle = '#15803d';
              ctx.fillText('OUT', cx + cellSize / 2, cy + cellSize / 2);
            } else {
              ctx.fillStyle = '#64748b';
              ctx.fillText('CHG', cx + cellSize / 2, cy + cellSize / 2);
            }
          }
        }
      }

      // Outer Arena Border & Axis Coordinates
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(offsetX, offsetY, gridW, gridH);

      ctx.font = '500 10px "JetBrains Mono", monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let x = 0; x < cols; x++) {
        ctx.fillText(String(x), offsetX + (x + 0.5) * cellSize, offsetY - 12);
      }
      for (let y = 0; y < rows; y++) {
        ctx.fillText(String(y), offsetX - 12, offsetY + (y + 0.5) * cellSize);
      }

      // 3. Narrow Passage Lock Overlay
      if (vis.narrowPassages) {
        for (const p of warehouse.passages) {
          if (p.cells.length === 0) continue;
          const minX = Math.min(...p.cells.map((c) => c.x));
          const minY = Math.min(...p.cells.map((c) => c.y));
          const maxX = Math.max(...p.cells.map((c) => c.x));
          const maxY = Math.max(...p.cells.map((c) => c.y));
          const rx = offsetX + minX * cellSize + 2;
          const ry = offsetY + minY * cellSize + 2;
          const rw = (maxX - minX + 1) * cellSize - 4;
          const rh = (maxY - minY + 1) * cellSize - 4;

          ctx.save();
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = p.lockedByRobotId ? '#d97706' : '#94a3b8';
          ctx.lineWidth = p.lockedByRobotId ? 2 : 1;
          ctx.strokeRect(rx, ry, rw, rh);
          ctx.restore();

          if (p.lockedByRobotId) {
            ctx.font = '600 9px "JetBrains Mono", monospace';
            ctx.fillStyle = '#b45309';
            ctx.textAlign = 'left';
            ctx.fillText(
              `${p.id} LOCK: ${p.lockedByRobotId}`,
              rx + 4,
              ry - 6 > offsetY ? ry - 6 : ry + 10
            );
          }
        }
      }

      // 4. Space-Time Reservation Lookahead Overlay
      if (vis.reservations) {
        for (const res of reservations) {
          if (res.kind !== 'CELL') continue;
          const dt = res.tick - snap.tick;
          if (dt <= 0 || dt > 6) continue;
          const robot = robots.find((r) => r.id === res.robotId);
          if (!robot || robot.status === 'IDLE') continue;
          const cx = offsetX + res.x * cellSize;
          const cy = offsetY + res.y * cellSize;
          ctx.save();
          ctx.globalAlpha = Math.max(0.06, 0.24 - dt * 0.03);
          ctx.fillStyle = robot.color;
          ctx.fillRect(cx + 6, cy + 6, cellSize - 12, cellSize - 12);
          ctx.restore();
        }
      }

      // 5. Active Job Pickup & Drop Badges
      for (const job of jobs) {
        if (job.status === 'COMPLETED') continue;
        if (job.status === 'PENDING' || job.status === 'ASSIGNED') {
          const px = offsetX + (job.pickup.x + 0.5) * cellSize;
          const py = offsetY + (job.pickup.y + 0.5) * cellSize;
          ctx.fillStyle = '#0284c7';
          ctx.fillRect(px - 6, py - 14, 12, 8);
        }
        const dx = offsetX + (job.drop.x + 0.5) * cellSize;
        const dy = offsetY + (job.drop.y + 0.5) * cellSize;
        ctx.strokeStyle = '#15803d';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(dx - 8, dy + 6, 16, 4);
      }

      // Pending custom pickup marker
      const pendingP = pendingPickupRef.current;
      if (pendingP) {
        const px = offsetX + pendingP.x * cellSize;
        const py = offsetY + pendingP.y * cellSize;
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(px + 2, py + 2, cellSize - 4, cellSize - 4);
      }

      // 6. Raw A* Grid Paths & Smoothed Spline Paths + Control Points
      for (const r of robots) {
        if (!r.path || r.status === 'FAILED' || r.status === 'IDLE') continue;
        const isSelected = selectedRobotRef.current === r.id;
        const alpha = selectedRobotRef.current && !isSelected ? 0.25 : 0.88;

        // 6a. Raw discrete grid path (dashed)
        if (vis.rawGridPaths && r.path.rawSteps.length > 1) {
          ctx.save();
          ctx.globalAlpha = alpha * 0.65;
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          const startStep = r.path.rawSteps[Math.max(0, r.pathStepIndex)];
          ctx.moveTo(
            offsetX + (startStep.x + 0.5) * cellSize,
            offsetY + (startStep.y + 0.5) * cellSize
          );
          for (let i = r.pathStepIndex + 1; i < r.path.rawSteps.length; i++) {
            const st = r.path.rawSteps[i];
            ctx.lineTo(
              offsetX + (st.x + 0.5) * cellSize,
              offsetY + (st.y + 0.5) * cellSize
            );
          }
          ctx.stroke();
          ctx.restore();
        }

        // 6b. Smoothed spline path (solid curved trajectory)
        if (vis.smoothedPaths && r.path.splinePoints.length > 1) {
          const startRange =
            r.path.stepToSplineRange[
              Math.min(
                r.pathStepIndex,
                Math.max(0, r.path.stepToSplineRange.length - 1)
              )
            ];
          const startSplineIdx = startRange ? startRange.start : 0;

          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = r.color;
          ctx.lineWidth = isSelected ? 3.2 : 2.2;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.beginPath();
          const p0 = r.path.splinePoints[startSplineIdx];
          if (p0) {
            ctx.moveTo(offsetX + p0.x * cellSize, offsetY + p0.y * cellSize);
            for (let i = startSplineIdx + 1; i < r.path.splinePoints.length; i++) {
              const pt = r.path.splinePoints[i];
              ctx.lineTo(offsetX + pt.x * cellSize, offsetY + pt.y * cellSize);
            }
            ctx.stroke();
          }

          // Intermediate spline sample points
          if (vis.splineControlPoints) {
            ctx.fillStyle = r.color;
            for (
              let i = startSplineIdx;
              i < r.path.splinePoints.length;
              i += 3
            ) {
              const pt = r.path.splinePoints[i];
              ctx.beginPath();
              ctx.arc(
                offsetX + pt.x * cellSize,
                offsetY + pt.y * cellSize,
                isSelected ? 2.4 : 1.7,
                0,
                Math.PI * 2
              );
              ctx.fill();
            }
          }
          ctx.restore();
        }
      }

      // 7. Compute live interpolated poses for all robots
      const robotPoses = new Map<
        string,
        { px: number; py: number; heading: number }
      >();
      for (const r of robots) {
        robotPoses.set(r.id, getInterpolatedRobotPose(r, progress));
      }

      // 8. Draw Wait-for Graph Arrows (deadlock visualization)
      if (vis.waitForGraph && waitEdges.length > 0) {
        for (const edge of waitEdges) {
          const fromPose = robotPoses.get(edge.waitingRobotId);
          const toPose = robotPoses.get(edge.blockingRobotId);
          if (!fromPose || !toPose) continue;
          const x1 = offsetX + fromPose.px * cellSize;
          const y1 = offsetY + fromPose.py * cellSize;
          const x2 = offsetX + toPose.px * cellSize;
          const y2 = offsetY + toPose.py * cellSize;

          ctx.save();
          ctx.strokeStyle = edge.inCycle ? '#dc2626' : '#d97706';
          ctx.lineWidth = edge.inCycle ? 2.5 : 1.8;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();

          // Arrowhead
          const ang = Math.atan2(y2 - y1, x2 - x1);
          const headLen = 8;
          ctx.fillStyle = edge.inCycle ? '#dc2626' : '#d97706';
          ctx.beginPath();
          ctx.moveTo(x2 - Math.cos(ang) * 14, y2 - Math.sin(ang) * 14);
          ctx.lineTo(
            x2 - Math.cos(ang) * 14 - Math.cos(ang - 0.5) * headLen,
            y2 - Math.sin(ang) * 14 - Math.sin(ang - 0.5) * headLen
          );
          ctx.lineTo(
            x2 - Math.cos(ang) * 14 - Math.cos(ang + 0.5) * headLen,
            y2 - Math.sin(ang) * 14 - Math.sin(ang + 0.5) * headLen
          );
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }

      // 9. Draw Hover Target Highlight
      const hover = hoverCellRef.current;
      if (hover) {
        const hx = offsetX + hover.x * cellSize;
        const hy = offsetY + hover.y * cellSize;
        ctx.save();
        ctx.strokeStyle =
          toolRef.current === 'BLOCK_CELL' ? '#dc2626' : '#0284c7';
        ctx.lineWidth = 2;
        ctx.strokeRect(hx + 1, hy + 1, cellSize - 2, cellSize - 2);
        ctx.restore();
      }

      // 10. Draw Robots
      for (const r of robots) {
        const pose = robotPoses.get(r.id)!;
        const cx = offsetX + pose.px * cellSize;
        const cy = offsetY + pose.py * cellSize;
        const radius = cellSize * 0.34;
        const isSelected = selectedRobotRef.current === r.id;

        ctx.save();
        ctx.translate(cx, cy);

        // Selection ring
        if (isSelected) {
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, radius + 5, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Robot chassis
        ctx.rotate(pose.heading);
        ctx.fillStyle = r.status === 'FAILED' ? '#dc2626' : r.color;
        ctx.beginPath();
        ctx.roundRect(-radius, -radius * 0.85, radius * 2, radius * 1.7, 5);
        ctx.fill();

        // Chassis border
        ctx.strokeStyle = r.status === 'FAILED' ? '#7f1d1d' : '#0f172a';
        ctx.lineWidth = 1.4;
        ctx.stroke();

        // Forward direction chevron
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.moveTo(radius * 0.72, 0);
        ctx.lineTo(radius * 0.25, -radius * 0.36);
        ctx.lineTo(radius * 0.25, radius * 0.36);
        ctx.closePath();
        ctx.fill();

        // Carried Package Box on Top
        if (r.carryingPackageId) {
          const box = radius * 0.95;
          ctx.fillStyle = r.status === 'FAILED' ? '#fef08a' : '#f59e0b';
          ctx.fillRect(-box * 0.65, -box * 0.55, box * 1.0, box * 1.1);
          ctx.strokeStyle = '#78350f';
          ctx.lineWidth = 1.2;
          ctx.strokeRect(-box * 0.65, -box * 0.55, box * 1.0, box * 1.1);
        }

        // Failed X overlay
        if (r.status === 'FAILED') {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(-radius * 0.45, -radius * 0.45);
          ctx.lineTo(radius * 0.45, radius * 0.45);
          ctx.moveTo(radius * 0.45, -radius * 0.45);
          ctx.lineTo(-radius * 0.45, radius * 0.45);
          ctx.stroke();
        }

        ctx.restore();

        // Robot ID label below/above
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = r.status === 'FAILED' ? '#b91c1c' : '#0f172a';
        ctx.fillText(r.id, cx, cy + radius + 9);

        // Explicit wait/fault indicator text
        if (r.status === 'FAILED') {
          ctx.font = '600 9px "JetBrains Mono", monospace';
          ctx.fillStyle = '#dc2626';
          ctx.fillText('FAULT', cx, cy - radius - 8);
        } else if (r.waitTicks > 0 && r.status !== 'IDLE') {
          ctx.font = '600 9px "JetBrains Mono", monospace';
          ctx.fillStyle = '#b45309';
          ctx.fillText(`WAIT ${r.waitTicks}`, cx, cy - radius - 8);
        } else if (r.status === 'RECOVERING_PACKAGE') {
          ctx.font = '600 9px "JetBrains Mono", monospace';
          ctx.fillStyle = '#0369a1';
          ctx.fillText('RECOVER', cx, cy - radius - 8);
        }
      }

      ctx.restore();
      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [tickTimestampRef]);

  const eventToGridCell = (
    e: React.MouseEvent<HTMLCanvasElement>
  ): GridCoord | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { cellSize, offsetX, offsetY, cols, rows } = getLayoutMetrics(
      rect.width,
      rect.height
    );
    const gx = Math.floor((mx - offsetX) / cellSize);
    const gy = Math.floor((my - offsetY) / cellSize);
    if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) return null;
    return { x: gx, y: gy };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setHoverCell(eventToGridCell(e));
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cell = eventToGridCell(e);
    if (!cell) {
      onSelectRobot(null);
      return;
    }

    // Check if user clicked on a robot first when in Inspect mode (or always allow selecting robot in Inspect mode)
    const clickedRobot = snapshot.robots.find(
      (r) => r.x === cell.x && r.y === cell.y
    );
    if (tool === 'INSPECT_ROBOT') {
      onSelectRobot(clickedRobot ? clickedRobot.id : null);
      return;
    }

    if (tool === 'BLOCK_CELL' && clickedRobot) {
      onSelectRobot(clickedRobot.id);
      return;
    }

    onCellClick(cell.x, cell.y);
  };

  const hoverObstacle = hoverCell
    ? snapshot.warehouse.dynamicObstacles.get(coordKey(hoverCell.x, hoverCell.y))
    : undefined;

  return (
    <div className="relative flex flex-col h-full w-full">
      <div ref={containerRef} className="relative flex-1 min-h-[420px] w-full">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverCell(null)}
          onClick={handleClick}
          className="block w-full h-full cursor-crosshair"
        />

        {/* Quiet top-left hover coordinate telemetry */}
        <div className="pointer-events-none absolute bottom-2 left-3 flex items-center gap-3 text-xs font-mono text-slate-600 bg-white/90 px-2.5 py-1 border border-slate-200 rounded">
          <span>
            {hoverCell
              ? `Cell (${hoverCell.x}, ${hoverCell.y}) · ${snapshot.warehouse.grid[hoverCell.y][hoverCell.x].replace('_', ' ')}`
              : 'Hover grid to inspect coordinates'}
          </span>
          {hoverObstacle && (
            <span className="text-red-600 font-medium">
              · {hoverObstacle.status} [T{hoverObstacle.startTick}..
              {hoverObstacle.endTick !== null ? `T${hoverObstacle.endTick}` : '∞'}] (
              {hoverObstacle.reason})
            </span>
          )}
        </div>
      </div>

      {/* Concise Legend Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-2.5 border-t border-slate-200 bg-white text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-xs bg-slate-800 inline-block" />
            Shelf
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-xs bg-amber-100 border border-amber-400 inline-block" />
            Narrow Aisle
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-xs bg-red-100 border border-red-600 inline-block" />
            Dynamic Obstacle
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-xs bg-sky-100 border border-sky-600 inline-block" />
            Pickup (IN)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-xs bg-emerald-100 border border-emerald-600 inline-block" />
            Drop (OUT)
          </span>
        </div>
        <div className="font-mono text-slate-500">
          Grid {snapshot.warehouse.cols}x{snapshot.warehouse.rows} ·{' '}
          {snapshot.warehouse.dynamicObstacles.size} Blocked Cells
        </div>
      </div>
    </div>
  );
};
