import React from 'react';
import { ArrowRight } from 'lucide-react';

interface HackathonGuideViewProps {
  onLaunchDemo: (
    scenario: 'narrow_passage' | 'failure_recovery' | 'dynamic_blockage'
  ) => void;
}

export const HackathonGuideView: React.FC<HackathonGuideViewProps> = ({
  onLaunchDemo,
}) => {
  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">
          Hackathon Implementation Blueprint &amp; Winning Differentiators
        </h2>
        <p className="text-sm text-slate-600 mt-1.5 max-w-3xl leading-relaxed">
          Everything required to solve the Warehouse Robot Coordination Arena
          problem statement is running live in this workspace. Below is how the
          algorithms map to the judging rubric and what sets this build apart.
        </p>
      </div>

      {/* Section 1: Core PS Checklist */}
      <section className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
        <div className="px-5 py-3.5 bg-slate-50">
          <h3 className="text-sm font-semibold text-slate-900">
            01. Core Problem Statement Requirements (Must-Haves)
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200">
          <div className="p-5 space-y-3 text-sm">
            <div>
              <div className="font-semibold text-slate-900">
                1. Model the Arena &amp; Live Job Queue
              </div>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Configurable grids with pickup docks, drop stations, shelves,
                charging bays, and 1-cell narrow corridors. Operators can queue
                jobs anytime while the fleet is running.
              </p>
            </div>
            <div>
              <div className="font-semibold text-slate-900">
                2. Assign &amp; Route in Space + Time
              </div>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Hungarian bipartite matching assigns jobs by true A* cost plus
                wait-aging. Space-Time A* plans `(x, y, t)` schedules around
                future vertex and edge reservations.
              </p>
            </div>
            <div>
              <div className="font-semibold text-slate-900">
                3. Prevent Collisions &amp; Break Deadlocks
              </div>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Centralized fleet coordinator validates every robot move
                simultaneously per tick, enforces directional narrow-aisle locks,
                and uses Wait-for Graph cycle detection to sidestep gridlocks.
              </p>
            </div>
          </div>

          <div className="p-5 space-y-3 text-sm">
            <div>
              <div className="font-semibold text-slate-900">
                4. Recover Robot Failures Without Losing Ownership
              </div>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Failed robots retain physical custody (`carrierRobotId`) of
                stranded cargo until a recovery unit reaches an adjacent handoff
                cell and executes an atomic custody transfer transaction.
              </p>
            </div>
            <div>
              <div className="font-semibold text-slate-900">
                5. Adapt to Dynamic Obstacles Mid-Run
              </div>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Clicking any aisle cell blocks or unblocks it immediately.
                Affected robots detect the obstruction, discard stale
                reservations, and smoothly reroute without resetting.
              </p>
            </div>
            <div>
              <div className="font-semibold text-slate-900">
                6. Measure Fleet Trade-Offs
              </div>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Live telemetry tracks throughput, waiting ticks, congestion
                percentage, deadlock counts, and Hungarian vs. Greedy
                allocation efficiency.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Winning Differentiators */}
      <section className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
        <div className="px-5 py-3.5 bg-slate-50">
          <h3 className="text-sm font-semibold text-slate-900">
            02. What Differentiates This From Average Hackathon Submissions
          </h3>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6 text-xs leading-relaxed text-slate-600">
          <div className="space-y-1.5">
            <div className="text-sm font-semibold text-slate-900">
              Obstacle-Clamped Spline Path Smoothing
            </div>
            <p>
              Most grid simulators move robots in choppy 90-degree staircase
              steps. Here, Space-Time A* steps pass through a Catmull-Rom /
              Chaikin curve generator that samples intermediate trajectory
              points and binary-clamps corners against shelf &amp; dynamic
              obstacle clearance radii (`r = 0.34`), pairing discrete safety
              guarantees with fluid real-world kinematics.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="text-sm font-semibold text-slate-900">
              Live Wait-for Graph &amp; Reservation X-Ray
            </div>
            <p>
              Judges can toggle overlays directly on the warehouse floor to see
              future space-time cell reservations, directional narrow-aisle
              locks, raw grid steps vs. smoothed spline curves, and directed
              Wait-for Graph arrows turning crimson when a deadlock cycle forms
              and resolves.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="text-sm font-semibold text-slate-900">
              Provable Unique-Carrier Custody Audit
            </div>
            <p>
              Instead of silently reassigning a boolean flag when a robot fails,
              the Event Ledger enforces and continuously audits the
              Unique-Carrier Invariant across every package custody transition:
              `AT_PICKUP → IN_TRANSIT → STRANDED → RECOVERING → DELIVERED`.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="text-sm font-semibold text-slate-900">
              1-Click Judge Verification Scenarios
            </div>
            <p>
              Do not waste demo minutes manually setting up edge cases. Use the
              three scenario triggers below to deterministically prove narrow
              aisle conflict handling, mid-transit failure recovery, and dynamic
              corridor rerouting on command.
            </p>
          </div>
        </div>
      </section>

      {/* Section 3: Direct Demo Launchers */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => onLaunchDemo('narrow_passage')}
          className="text-left bg-white border border-slate-200 hover:border-sky-400 rounded-lg p-4 transition-colors group"
        >
          <div className="flex items-center justify-between text-sm font-semibold text-slate-900">
            <span>Demo 1: Narrow Passage</span>
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-sky-600" />
          </div>
          <p className="text-xs text-slate-500 mt-1.5">
            Launch R01 &amp; R02 head-on at the North Express Tunnel and watch
            passage locking + priority yielding.
          </p>
        </button>

        <button
          type="button"
          onClick={() => onLaunchDemo('failure_recovery')}
          className="text-left bg-white border border-slate-200 hover:border-amber-400 rounded-lg p-4 transition-colors group"
        >
          <div className="flex items-center justify-between text-sm font-semibold text-slate-900">
            <span>Demo 2: Failure Recovery</span>
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-amber-600" />
          </div>
          <p className="text-xs text-slate-500 mt-1.5">
            Inject a hardware fault on a package-carrying unit and verify
            atomic handoff to a recovery robot.
          </p>
        </button>

        <button
          type="button"
          onClick={() => onLaunchDemo('dynamic_blockage')}
          className="text-left bg-white border border-slate-200 hover:border-red-400 rounded-lg p-4 transition-colors group"
        >
          <div className="flex items-center justify-between text-sm font-semibold text-slate-900">
            <span>Demo 3: Dynamic Blockage</span>
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-red-600" />
          </div>
          <p className="text-xs text-slate-500 mt-1.5">
            Drop an obstacle into an active corridor and observe instant
            detection, Space-Time replanning, and curve smoothing.
          </p>
        </button>
      </section>
    </div>
  );
};
