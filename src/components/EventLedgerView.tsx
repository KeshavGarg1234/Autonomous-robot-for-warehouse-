import React, { useState } from 'react';
import { ArenaEventType, SimulationStateSnapshot } from '../engine/types';
import { verifyUniqueCarrierInvariant } from '../engine/packageManager';

interface EventLedgerViewProps {
  snapshot: SimulationStateSnapshot;
}

const FILTER_GROUPS: { label: string; types: ArenaEventType[] | null }[] = [
  { label: 'All Events', types: null },
  {
    label: 'Obstacles & Reroutes',
    types: ['OBSTACLE_BLOCKED', 'OBSTACLE_UNBLOCKED', 'PATH_RECALCULATED'],
  },
  {
    label: 'Passages & Deadlocks',
    types: [
      'AISLE_RESERVED',
      'AISLE_RELEASED',
      'DEADLOCK_DETECTED',
      'DEADLOCK_RESOLVED',
      'ROBOT_WAITING',
    ],
  },
  {
    label: 'Custody & Failures',
    types: [
      'ROBOT_FAILED',
      'ROBOT_REPAIRED',
      'PACKAGE_PICKED_UP',
      'PACKAGE_RECOVERY_STARTED',
      'PACKAGE_TRANSFERRED',
      'PACKAGE_DELIVERED',
    ],
  },
];

export const EventLedgerView: React.FC<EventLedgerViewProps> = ({
  snapshot,
}) => {
  const [activeFilter, setActiveFilter] = useState(0);
  const invariantCheck = verifyUniqueCarrierInvariant(
    snapshot.packages,
    snapshot.robots
  );

  const allowedTypes = FILTER_GROUPS[activeFilter].types;
  const filteredEvents = allowedTypes
    ? snapshot.events.filter((e) => allowedTypes.includes(e.type))
    : snapshot.events;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            Append-Only Event Log &amp; Package Custody Ledger
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Audits every job transition, narrow-aisle lock, dynamic obstacle
            replan, and atomic package custody transfer.
          </p>
        </div>

        <div
          className={`px-3.5 py-2 rounded-lg border text-xs font-mono ${
            invariantCheck.valid
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          Unique-Carrier Invariant:{' '}
          {invariantCheck.valid
            ? 'VERIFIED (0 Duplicate Carriers)'
            : `VIOLATION: ${invariantCheck.violations.join('; ')}`}
        </div>
      </div>

      {/* Package Custody Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Package Custody Chain
          </h3>
          <span className="text-xs font-mono text-slate-500">
            {snapshot.packages.length} Tracked Packages
          </span>
        </div>
        <div className="overflow-x-auto max-h-64 overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <th className="py-2 px-4 font-semibold">Package</th>
                <th className="py-2 px-4 font-semibold">Job</th>
                <th className="py-2 px-4 font-semibold">Status</th>
                <th className="py-2 px-4 font-semibold">Active Carrier</th>
                <th className="py-2 px-4 font-semibold">Custody Trail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {snapshot.packages.slice(0, 25).map((pkg) => (
                <tr key={pkg.id} className="hover:bg-slate-50">
                  <td className="py-2 px-4 font-semibold text-slate-900">
                    {pkg.id}
                  </td>
                  <td className="py-2 px-4 text-slate-600">{pkg.jobId}</td>
                  <td
                    className={`py-2 px-4 font-medium ${
                      pkg.status === 'DELIVERED'
                        ? 'text-emerald-700'
                        : pkg.status === 'STRANDED'
                        ? 'text-red-700'
                        : pkg.status === 'RECOVERING'
                        ? 'text-amber-700'
                        : 'text-sky-700'
                    }`}
                  >
                    {pkg.status}
                  </td>
                  <td className="py-2 px-4 text-slate-900">
                    {pkg.carrierRobotId ?? '—'}
                  </td>
                  <td className="py-2 px-4 text-slate-600">
                    {pkg.custodyHistory
                      .map(
                        (h) =>
                          `T${h.tick}:${h.action}${
                            h.toRobotId ? `(${h.toRobotId})` : ''
                          }`
                      )
                      .join(' → ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Event Stream */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Simulation Event Stream
          </h3>
          <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-lg">
            {FILTER_GROUPS.map((fg, i) => (
              <button
                key={fg.label}
                type="button"
                onClick={() => setActiveFilter(i)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  activeFilter === i
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {fg.label}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-slate-100 max-h-[380px] overflow-y-auto font-mono text-xs">
          {filteredEvents.length === 0 ? (
            <div className="p-8 text-center text-slate-500 font-sans">
              No matching events logged yet. Start the simulation or trigger a
              scenario to observe coordinator decisions.
            </div>
          ) : (
            filteredEvents.map((ev) => (
              <div
                key={ev.id}
                className="px-4 py-2 flex items-center gap-4 hover:bg-slate-50"
              >
                <span className="text-slate-400 shrink-0">{ev.timestamp}</span>
                <span className="text-slate-500 shrink-0 w-14">
                  T{ev.tick}
                </span>
                <span
                  className={`shrink-0 w-44 font-semibold ${
                    ev.type.includes('FAIL') ||
                    ev.type === 'OBSTACLE_BLOCKED' ||
                    ev.type === 'DEADLOCK_DETECTED'
                      ? 'text-red-700'
                      : ev.type.includes('DELIVERED') ||
                        ev.type === 'DEADLOCK_RESOLVED' ||
                        ev.type === 'PACKAGE_TRANSFERRED'
                      ? 'text-emerald-700'
                      : ev.type.includes('AISLE') ||
                        ev.type === 'PATH_RECALCULATED'
                      ? 'text-amber-700'
                      : 'text-sky-700'
                  }`}
                >
                  {ev.type}
                </span>
                <span className="text-slate-800">{ev.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
