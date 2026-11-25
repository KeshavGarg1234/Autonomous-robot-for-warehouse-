import React from 'react';
import { SimulationStateSnapshot, TickMetricSnapshot } from '../engine/types';

interface AnalyticsViewProps {
  snapshot: SimulationStateSnapshot;
}

interface SeriesPoint {
  x: number;
  y: number;
}

function buildPolyline(
  data: TickMetricSnapshot[],
  accessor: (d: TickMetricSnapshot) => number,
  width: number,
  height: number,
  maxValOverride?: number
): { points: string; maxVal: number; latest: number } {
  if (data.length === 0) {
    return { points: '', maxVal: 1, latest: 0 };
  }
  const padX = 8;
  const padY = 12;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const maxRaw = Math.max(...data.map(accessor), 1);
  const maxVal = maxValOverride ?? maxRaw;

  const coords: SeriesPoint[] = data.map((d, i) => {
    const x =
      data.length === 1
        ? padX + innerW / 2
        : padX + (i / (data.length - 1)) * innerW;
    const val = accessor(d);
    const y = padY + innerH - (Math.min(val, maxVal) / maxVal) * innerH;
    return { x, y };
  });

  return {
    points: coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
    maxVal,
    latest: accessor(data[data.length - 1]),
  };
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ snapshot }) => {
  const { metricsHistory, latestMetrics, robots } = snapshot;

  const throughputLine = buildPolyline(
    metricsHistory,
    (d) => d.completedJobs,
    460,
    150
  );
  const congestionLine = buildPolyline(
    metricsHistory,
    (d) => d.congestionIndex,
    460,
    150,
    100
  );
  const waitLine = buildPolyline(
    metricsHistory,
    (d) => d.avgWaitTicks,
    460,
    150
  );

  // Path Smoother Efficiency comparison across active robots
  const activeSmoothed = robots.filter((r) => r.path && r.path.rawManhattanLength > 0);
  const totalRawLen = activeSmoothed.reduce(
    (s, r) => s + (r.path?.rawManhattanLength ?? 0),
    0
  );
  const totalArcLen = activeSmoothed.reduce(
    (s, r) => s + (r.path?.totalArcLength ?? 0),
    0
  );
  const arcReductionPct =
    totalRawLen > 0
      ? Math.max(0, ((totalRawLen - totalArcLen) / totalRawLen) * 100).toFixed(1)
      : '0.0';

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">
          Fleet Performance &amp; Trade-Off Analytics
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Live operational telemetry comparing throughput, waiting congestion,
          replanning resilience, and smoothed trajectory efficiency.
        </p>
      </div>

      {/* Top KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Completed Deliveries</div>
          <div className="text-2xl font-semibold font-mono text-slate-900 mt-1">
            {latestMetrics.completedJobs}
          </div>
          <div className="text-xs text-slate-500 mt-1 font-mono">
            Avg {latestMetrics.avgDeliveryTicks} ticks / job
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Fleet Congestion Index</div>
          <div className="text-2xl font-semibold font-mono text-slate-900 mt-1">
            {latestMetrics.congestionIndex}%
          </div>
          <div className="text-xs text-slate-500 mt-1 font-mono">
            {latestMetrics.waitingRobots} waiting · {latestMetrics.activeRobots}{' '}
            active
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">
            Deadlocks &amp; Replans
          </div>
          <div className="text-2xl font-semibold font-mono text-slate-900 mt-1">
            {latestMetrics.deadlockCount} / {latestMetrics.replanCount}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Cycles broken · dynamic reroutes
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">
            Spline Path Length Delta
          </div>
          <div className="text-2xl font-semibold font-mono text-sky-700 mt-1">
            -{arcReductionPct}%
          </div>
          <div className="text-xs text-slate-500 mt-1 font-mono">
            {snapshot.smoothingMode} (T={snapshot.smoothingTension.toFixed(2)})
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              Cumulative Throughput
            </h3>
            <span className="font-mono text-xs text-emerald-700">
              {throughputLine.latest} jobs
            </span>
          </div>
          <svg
            viewBox="0 0 460 150"
            className="w-full h-36 bg-slate-50 rounded border border-slate-100"
          >
            <line
              x1="8"
              y1="75"
              x2="452"
              y2="75"
              stroke="#e2e8f0"
              strokeDasharray="3 3"
            />
            {throughputLine.points && (
              <polyline
                fill="none"
                stroke="#059669"
                strokeWidth="2.5"
                points={throughputLine.points}
              />
            )}
          </svg>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              Congestion Ratio
            </h3>
            <span className="font-mono text-xs text-amber-700">
              {congestionLine.latest}%
            </span>
          </div>
          <svg
            viewBox="0 0 460 150"
            className="w-full h-36 bg-slate-50 rounded border border-slate-100"
          >
            <line
              x1="8"
              y1="75"
              x2="452"
              y2="75"
              stroke="#e2e8f0"
              strokeDasharray="3 3"
            />
            {congestionLine.points && (
              <polyline
                fill="none"
                stroke="#d97706"
                strokeWidth="2.5"
                points={congestionLine.points}
              />
            )}
          </svg>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              Mean Robot Wait Ticks
            </h3>
            <span className="font-mono text-xs text-sky-700">
              {waitLine.latest} ticks
            </span>
          </div>
          <svg
            viewBox="0 0 460 150"
            className="w-full h-36 bg-slate-50 rounded border border-slate-100"
          >
            <line
              x1="8"
              y1="75"
              x2="452"
              y2="75"
              stroke="#e2e8f0"
              strokeDasharray="3 3"
            />
            {waitLine.points && (
              <polyline
                fill="none"
                stroke="#0284c7"
                strokeWidth="2.5"
                points={waitLine.points}
              />
            )}
          </svg>
        </div>
      </div>

      {/* Per-Robot Utilization Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Per-Unit Utilization &amp; Trajectory Telemetry
          </h3>
          <span className="text-xs font-mono text-slate-500">
            Allocator: {snapshot.allocationStrategy}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <th className="py-2.5 px-4 font-semibold">Robot</th>
                <th className="py-2.5 px-4 font-semibold">Status</th>
                <th className="py-2.5 px-4 font-semibold text-right">Moves</th>
                <th className="py-2.5 px-4 font-semibold text-right">
                  Total Wait Ticks
                </th>
                <th className="py-2.5 px-4 font-semibold text-right">
                  Efficiency
                </th>
                <th className="py-2.5 px-4 font-semibold text-right">
                  Grid Steps vs Spline Arc
                </th>
                <th className="py-2.5 px-4 font-semibold text-right">
                  Battery
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {robots.map((r) => {
                const denom = r.totalMoves + r.totalWaitTicks;
                const eff =
                  denom > 0 ? Math.round((r.totalMoves / denom) * 100) : 100;
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-semibold text-slate-900">
                      {r.id}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700">{r.status}</td>
                    <td className="py-2.5 px-4 text-right text-slate-900">
                      {r.totalMoves}
                    </td>
                    <td className="py-2.5 px-4 text-right text-slate-700">
                      {r.totalWaitTicks}
                    </td>
                    <td className="py-2.5 px-4 text-right text-slate-900">
                      {eff}%
                    </td>
                    <td className="py-2.5 px-4 text-right text-slate-700">
                      {r.path
                        ? `${r.path.rawManhattanLength} / ${r.path.totalArcLength.toFixed(1)}`
                        : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right text-slate-900">
                      {r.battery.toFixed(0)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
