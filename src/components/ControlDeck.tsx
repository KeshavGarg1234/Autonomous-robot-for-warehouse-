import React, { useState } from 'react';
import {
  AlertTriangle,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ShieldAlert,
  SkipForward,
  Trash2,
  Wrench,
} from 'lucide-react';
import {
  AllocationStrategy,
  JobGenerationMode,
  SimulationStateSnapshot,
  SmoothingMode,
} from '../engine/types';
import {
  getWarehousePresets,
  WarehousePresetId,
} from '../engine/warehouseManager';

interface ControlDeckProps {
  snapshot: SimulationStateSnapshot;
  selectedRobotId: string | null;
  onToggleRun: () => void;
  onStepTick: () => void;
  onReset: (presetId?: WarehousePresetId) => void;
  onSpeedChange: (speed: number) => void;
  onAllocationChange: (strategy: AllocationStrategy) => void;
  onJobModeChange: (mode: JobGenerationMode) => void;
  onToggleAutoJobsPlaying: () => void;
  onClearPendingJobs: () => void;
  onOpenDispatchModal: () => void;
  onSmoothingChange: (mode: SmoothingMode, tension: number) => void;
  onTriggerScenario: (
    scenario: 'narrow_passage' | 'failure_recovery' | 'dynamic_blockage'
  ) => void;
  onFailRobot: (robotId: string) => void;
  onRepairRobot: (robotId: string) => void;
  onAddRobot: () => void;
  onAddRandomJob: () => void;
  onSelectRobot: (robotId: string | null) => void;
  onUnblockAll: () => void;
}

type DeckTab = 'controls' | 'fleet' | 'jobs';

function formatRobotStatusLabel(status: string): {
  text: string;
  cls: string;
} {
  switch (status) {
    case 'IDLE':
      return { text: 'IDLE', cls: 'text-slate-500' };
    case 'MOVING_TO_PICKUP':
      return { text: 'TO PICKUP', cls: 'text-sky-700' };
    case 'CARRYING_TO_DROP':
      return { text: 'CARRYING', cls: 'text-emerald-700' };
    case 'RECOVERING_PACKAGE':
      return { text: 'RECOVERING', cls: 'text-amber-700' };
    case 'FAILED':
      return { text: 'FAILED', cls: 'text-red-700 font-semibold' };
    default:
      return { text: status, cls: 'text-slate-700' };
  }
}

export const ControlDeck: React.FC<ControlDeckProps> = ({
  snapshot,
  selectedRobotId,
  onToggleRun,
  onStepTick,
  onReset,
  onSpeedChange,
  onAllocationChange,
  onJobModeChange,
  onToggleAutoJobsPlaying,
  onClearPendingJobs,
  onOpenDispatchModal,
  onSmoothingChange,
  onTriggerScenario,
  onFailRobot,
  onRepairRobot,
  onAddRobot,
  onAddRandomJob,
  onSelectRobot,
  onUnblockAll,
}) => {
  const [deckTab, setDeckTab] = useState<DeckTab>('controls');
  const presets = getWarehousePresets();

  const selectedRobot = snapshot.robots.find((r) => r.id === selectedRobotId);

  return (
    <aside className="flex flex-col h-full bg-white border-l border-slate-200 overflow-hidden">
      {/* Segmented Control Tabs */}
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70">
        <div className="grid grid-cols-3 gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setDeckTab('controls')}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              deckTab === 'controls'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Controls
          </button>
          <button
            type="button"
            onClick={() => setDeckTab('fleet')}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              deckTab === 'fleet'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Fleet ({snapshot.robots.length})
          </button>
          <button
            type="button"
            onClick={() => setDeckTab('jobs')}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              deckTab === 'jobs'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Jobs ({snapshot.jobs.filter((j) => j.status !== 'COMPLETED').length})
          </button>
        </div>
      </div>

      {/* Scrollable Deck Body */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-200">
        {deckTab === 'controls' && (
          <>
            {/* Simulation Clock & Playback */}
            <section className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  Simulation Engine
                </h3>
                <span className="font-mono text-xs text-slate-500">
                  Tick {snapshot.tick} · {(5 * snapshot.speedMultiplier).toFixed(0)} Hz
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleRun}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    snapshot.running
                      ? 'bg-amber-600 text-white hover:bg-amber-700'
                      : 'bg-sky-600 text-white hover:bg-sky-700'
                  }`}
                >
                  {snapshot.running ? (
                    <>
                      <Pause className="w-3.5 h-3.5" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" />
                      Start
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={onStepTick}
                  disabled={snapshot.running}
                  title="Advance 1 discrete simulation tick"
                  className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                  Step
                </button>
                <button
                  type="button"
                  onClick={() => onReset()}
                  title="Reset simulation"
                  className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset
                </button>
              </div>

              {/* Speed Multiplier */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-slate-600">Clock Speed</span>
                <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-md">
                  {[1, 2, 5, 10].map((spd) => (
                    <button
                      key={spd}
                      type="button"
                      onClick={() => onSpeedChange(spd)}
                      className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
                        snapshot.speedMultiplier === spd
                          ? 'bg-white text-slate-900 font-semibold shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {spd}x
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Job Dispatch Mode: Auto (Play/Pause) vs Manual */}
            <section className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  Job Generation Mode
                </h3>
                <span className="font-mono text-xs text-slate-500">
                  {snapshot.jobMode === 'AUTO'
                    ? snapshot.autoJobsPlaying
                      ? 'AUTO · PLAYING'
                      : 'AUTO · PAUSED'
                    : 'MANUAL'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => onJobModeChange('AUTO')}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    snapshot.jobMode === 'AUTO'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Auto Jobs
                </button>
                <button
                  type="button"
                  onClick={() => onJobModeChange('MANUAL')}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    snapshot.jobMode === 'MANUAL'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Manual Setup
                </button>
              </div>

              {snapshot.jobMode === 'AUTO' ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onToggleAutoJobsPlaying}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                      snapshot.autoJobsPlaying
                        ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                    }`}
                  >
                    {snapshot.autoJobsPlaying ? (
                      <>
                        <Pause className="w-3.5 h-3.5" />
                        Pause Auto-Add
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5" />
                        Play Auto-Add
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={onOpenDispatchModal}
                    className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Custom
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onOpenDispatchModal}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Setup Job (Pickup / Drop)
                    </button>
                    <button
                      type="button"
                      onClick={onClearPendingJobs}
                      title="Clear unassigned pending jobs"
                      className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Clear
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Auto-spawning is off. Queue jobs via Setup Job or use the
                    Click Pickup → Drop grid tool.
                  </p>
                </div>
              )}
            </section>

            {/* Path Smoother Configuration */}
            <section className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  Trajectory Path Smoother
                </h3>
                <span className="text-xs text-slate-500">
                  Spline Interpolation
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                {(
                  [
                    { id: 'CATMULL_ROM', label: 'Catmull-Rom' },
                    { id: 'CHAIKIN', label: 'Chaikin' },
                    { id: 'RAW', label: 'Raw Grid' },
                  ] as { id: SmoothingMode; label: string }[]
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() =>
                      onSmoothingChange(m.id, snapshot.smoothingTension)
                    }
                    className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      snapshot.smoothingMode === m.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="tension-slider" className="text-slate-600">
                    Curve Tension / Corner Smoothness
                  </label>
                  <span className="font-mono text-slate-900">
                    {snapshot.smoothingTension.toFixed(2)}
                  </span>
                </div>
                <input
                  id="tension-slider"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  disabled={snapshot.smoothingMode === 'RAW'}
                  value={snapshot.smoothingTension}
                  onChange={(e) =>
                    onSmoothingChange(
                      snapshot.smoothingMode,
                      parseFloat(e.target.value)
                    )
                  }
                  className="w-full accent-sky-600 cursor-pointer disabled:opacity-40"
                />
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Clamps spline control points against shelf &amp; dynamic
                  obstacle clearance bounds (`r = 0.34` cells).
                </p>
              </div>
            </section>

            {/* Coordination & Warehouse Layout */}
            <section className="p-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Coordinator &amp; Arena Layout
              </h3>

              <div className="space-y-1.5">
                <span className="text-xs text-slate-600 block">
                  Job Allocation Algorithm
                </span>
                <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                  {(
                    [
                      { id: 'HUNGARIAN', label: 'Hungarian (Optimal)' },
                      { id: 'GREEDY', label: 'Greedy Nearest' },
                    ] as { id: AllocationStrategy; label: string }[]
                  ).map((alg) => (
                    <button
                      key={alg.id}
                      type="button"
                      onClick={() => onAllocationChange(alg.id)}
                      className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        snapshot.allocationStrategy === alg.id
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {alg.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="preset-select"
                  className="text-xs text-slate-600 block"
                >
                  Warehouse Topology
                </label>
                <select
                  id="preset-select"
                  value={snapshot.warehouse.id}
                  onChange={(e) =>
                    onReset(e.target.value as WarehousePresetId)
                  }
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {snapshot.warehouse.dynamicObstacles.size > 0 && (
                <button
                  type="button"
                  onClick={onUnblockAll}
                  className="w-full px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors"
                >
                  Clear All {snapshot.warehouse.dynamicObstacles.size} Blocked
                  Cells
                </button>
              )}
            </section>

            {/* Hackathon PS Challenge Scenarios */}
            <section className="p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  Challenge Scenarios
                </h3>
                <span className="text-xs text-slate-500">1-Click Demos</span>
              </div>
              <p className="text-xs text-slate-500">
                Trigger the three required verification scenarios live without
                losing delivery records.
              </p>

              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => onTriggerScenario('narrow_passage')}
                  className="w-full text-left px-3 py-2 border border-slate-200 hover:border-sky-300 hover:bg-sky-50/50 rounded-lg transition-colors"
                >
                  <div className="text-xs font-semibold text-slate-900">
                    1. Narrow-Passage Conflict
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Opposing robots lock &amp; yield across 1-cell aisle
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onTriggerScenario('failure_recovery')}
                  className="w-full text-left px-3 py-2 border border-slate-200 hover:border-amber-300 hover:bg-amber-50/50 rounded-lg transition-colors"
                >
                  <div className="text-xs font-semibold text-slate-900">
                    2. Robot Failure &amp; Package Custody
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Fault carrying unit &amp; dispatch atomic recovery handoff
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onTriggerScenario('dynamic_blockage')}
                  className="w-full text-left px-3 py-2 border border-slate-200 hover:border-red-300 hover:bg-red-50/50 rounded-lg transition-colors"
                >
                  <div className="text-xs font-semibold text-slate-900">
                    3. Dynamic Aisle Blockage
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Drop live obstacle ahead of robot &amp; smooth reroute
                  </div>
                </button>
              </div>
            </section>
          </>
        )}

        {deckTab === 'fleet' && (
          <div className="divide-y divide-slate-200">
            <div className="p-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Robot Fleet Status
                </h3>
                <p className="text-xs text-slate-500">
                  Click any unit to inspect path smoothing or inject fault
                </p>
              </div>
              <button
                type="button"
                onClick={onAddRobot}
                disabled={snapshot.robots.length >= 10}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Unit
              </button>
            </div>

            {selectedRobot && (
              <div className="p-4 bg-slate-50 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-xs inline-block"
                      style={{ backgroundColor: selectedRobot.color }}
                    />
                    <span className="text-sm font-semibold text-slate-900 font-mono">
                      {selectedRobot.id}
                    </span>
                    <span className="text-xs text-slate-500">
                      · ({selectedRobot.x},{selectedRobot.y})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectRobot(null)}
                    className="text-xs text-slate-500 hover:text-slate-800"
                  >
                    Clear
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="text-slate-600">
                    Battery:{' '}
                    <span className="text-slate-900">
                      {selectedRobot.battery.toFixed(0)}%
                    </span>
                  </div>
                  <div className="text-slate-600">
                    Package:{' '}
                    <span className="text-slate-900">
                      {selectedRobot.carryingPackageId ?? 'None'}
                    </span>
                  </div>
                  <div className="text-slate-600">
                    Spline Pts:{' '}
                    <span className="text-slate-900">
                      {selectedRobot.path?.splinePoints.length ?? 0}
                    </span>
                  </div>
                  <div className="text-slate-600">
                    Arc Len:{' '}
                    <span className="text-slate-900">
                      {selectedRobot.path
                        ? selectedRobot.path.totalArcLength.toFixed(1)
                        : '0.0'}
                    </span>
                  </div>
                </div>

                <div className="pt-1">
                  {selectedRobot.status === 'FAILED' ? (
                    <button
                      type="button"
                      onClick={() => onRepairRobot(selectedRobot.id)}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg"
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      Repair &amp; Restore {selectedRobot.id}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onFailRobot(selectedRobot.id)}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Simulate Hardware Fault on {selectedRobot.id}
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="divide-y divide-slate-100">
              {snapshot.robots.map((r) => {
                const st = formatRobotStatusLabel(r.status);
                const isSel = selectedRobotId === r.id;
                return (
                  <div
                    key={r.id}
                    onClick={() => onSelectRobot(r.id)}
                    className={`px-4 py-3 flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                      isSel ? 'bg-sky-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-xs shrink-0"
                          style={{
                            backgroundColor:
                              r.status === 'FAILED' ? '#dc2626' : r.color,
                          }}
                        />
                        <span className="font-mono text-xs font-semibold text-slate-900">
                          {r.id}
                        </span>
                        <span className={`text-xs font-mono ${st.cls}`}>
                          {st.text}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                        Pos ({r.x},{r.y}) · Job {r.jobId ?? '—'} · Cargo{' '}
                        {r.carryingPackageId ?? '—'}
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-1.5">
                      {r.status === 'FAILED' ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRepairRobot(r.id);
                          }}
                          className="px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 border border-emerald-200 rounded"
                        >
                          Repair
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onFailRobot(r.id);
                          }}
                          className="px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 border border-red-200 rounded"
                        >
                          Fail
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {deckTab === 'jobs' && (
          <div className="divide-y divide-slate-200">
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Delivery Jobs Queue
                  </h3>
                  <p className="text-xs text-slate-500">
                    {snapshot.jobMode === 'AUTO'
                      ? snapshot.autoJobsPlaying
                        ? 'Auto-adding jobs when queue < 3'
                        : 'Auto job creation paused'
                      : 'Manual dispatch mode active'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onOpenDispatchModal}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Setup Job
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex-1 grid grid-cols-2 gap-1 p-0.5 bg-slate-100 rounded-md">
                  <button
                    type="button"
                    onClick={() => onJobModeChange('AUTO')}
                    className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
                      snapshot.jobMode === 'AUTO'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600'
                    }`}
                  >
                    Auto
                  </button>
                  <button
                    type="button"
                    onClick={() => onJobModeChange('MANUAL')}
                    className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
                      snapshot.jobMode === 'MANUAL'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600'
                    }`}
                  >
                    Manual
                  </button>
                </div>

                {snapshot.jobMode === 'AUTO' ? (
                  <button
                    type="button"
                    onClick={onToggleAutoJobsPlaying}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap ${
                      snapshot.autoJobsPlaying
                        ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                    }`}
                  >
                    {snapshot.autoJobsPlaying ? (
                      <>
                        <Pause className="w-3 h-3" />
                        Pause Auto
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3" />
                        Play Auto
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onAddRandomJob}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-md whitespace-nowrap"
                  >
                    <Plus className="w-3 h-3" />
                    Quick Random
                  </button>
                )}
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {snapshot.jobs.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No jobs queued. Click Setup Job or use Click Pickup → Drop on
                  the warehouse grid.
                </div>
              ) : (
                snapshot.jobs.slice(0, 30).map((job) => {
                  const pkg = snapshot.packages.find(
                    (p) => p.id === job.packageId
                  );
                  return (
                    <div key={job.id} className="px-4 py-2.5 space-y-1">
                      <div className="flex items-center justify-between text-xs gap-2">
                        <span className="font-mono font-semibold text-slate-900 truncate">
                          {job.id} · {job.packageLabel}
                        </span>
                        <span
                          className={`font-mono text-[11px] font-medium shrink-0 ${
                            job.status === 'COMPLETED'
                              ? 'text-emerald-700'
                              : job.status === 'RECOVERY_PENDING'
                              ? 'text-red-700'
                              : job.status === 'IN_PROGRESS'
                              ? 'text-sky-700'
                              : 'text-slate-600'
                          }`}
                        >
                          {job.status === 'RECOVERY_PENDING' && (
                            <AlertTriangle className="w-3 h-3 inline mr-1" />
                          )}
                          {job.status}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
                        <span>
                          ({job.pickup.x},{job.pickup.y}) → ({job.drop.x},
                          {job.drop.y})
                        </span>
                        <span>
                          Carrier: {pkg?.carrierRobotId ?? 'None'} ·{' '}
                          {pkg?.status ?? ''}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
