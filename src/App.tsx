import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Ban,
  Crosshair,
  MapPin,
  Plus,
} from 'lucide-react';
import { WarehouseSimulationEngine } from './engine/simulationEngine';
import {
  AllocationStrategy,
  GridCoord,
  InteractionTool,
  JobGenerationMode,
  LayerVisibility,
  SimulationStateSnapshot,
  SmoothingMode,
} from './engine/types';
import {
  isCellWalkable,
  WarehousePresetId,
} from './engine/warehouseManager';
import { WarehouseCanvas } from './components/WarehouseCanvas';
import { ControlDeck } from './components/ControlDeck';
import { AnalyticsView } from './components/AnalyticsView';
import { EventLedgerView } from './components/EventLedgerView';
import { HackathonGuideView } from './components/HackathonGuideView';
import { DispatchJobModal } from './components/DispatchJobModal';

type AppView = 'simulator' | 'analytics' | 'ledger' | 'guide';

export default function App() {
  const engineRef = useRef<WarehouseSimulationEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new WarehouseSimulationEngine('narrow_hub');
  }

  const tickTimestampRef = useRef<number>(performance.now());
  const [snapshot, setSnapshot] = useState<SimulationStateSnapshot>(() =>
    engineRef.current!.getSnapshot()
  );

  const [activeView, setActiveView] = useState<AppView>('simulator');
  const [tool, setTool] = useState<InteractionTool>('BLOCK_CELL');
  const [blockWindowMode, setBlockWindowMode] = useState<
    'PERMANENT' | 'TEMP_12' | 'SCHED_3_15'
  >('TEMP_12');
  const [selectedRobotId, setSelectedRobotId] = useState<string | null>(null);
  const [pendingPickup, setPendingPickup] = useState<GridCoord | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showDispatchModal, setShowDispatchModal] = useState(false);

  const [layers, setLayers] = useState<LayerVisibility>({
    smoothedPaths: true,
    rawGridPaths: true,
    splineControlPoints: false,
    reservations: true,
    waitForGraph: true,
    narrowPassages: true,
  });

  const syncSnapshot = useCallback(() => {
    if (!engineRef.current) return;
    setSnapshot(engineRef.current.getSnapshot());
  }, []);

  // Discrete simulation clock (independent of 60fps Canvas render loop)
  useEffect(() => {
    if (!snapshot.running) return;
    const intervalMs = Math.max(
      20,
      Math.round(snapshot.baseTickMs / snapshot.speedMultiplier)
    );
    const timer = window.setInterval(() => {
      if (!engineRef.current) return;
      engineRef.current.stepTick();
      tickTimestampRef.current = performance.now();
      setSnapshot(engineRef.current.getSnapshot());
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [snapshot.running, snapshot.speedMultiplier, snapshot.baseTickMs]);

  const showFeedback = (msg: string) => {
    setStatusMessage(msg);
  };

  const handleToggleRun = () => {
    const eng = engineRef.current!;
    eng.setRunning(!snapshot.running);
    tickTimestampRef.current = performance.now();
    syncSnapshot();
  };

  const handleStepTick = () => {
    const eng = engineRef.current!;
    eng.stepTick();
    tickTimestampRef.current = performance.now();
    syncSnapshot();
  };

  const handleReset = (presetId?: WarehousePresetId) => {
    const eng = engineRef.current!;
    eng.reset(presetId);
    setSelectedRobotId(null);
    setPendingPickup(null);
    setStatusMessage(null);
    tickTimestampRef.current = performance.now();
    syncSnapshot();
  };

  const handleSpeedChange = (speed: number) => {
    engineRef.current!.setSpeedMultiplier(speed);
    syncSnapshot();
  };

  const handleAllocationChange = (strategy: AllocationStrategy) => {
    engineRef.current!.setAllocationStrategy(strategy);
    syncSnapshot();
  };

  const handleSmoothingChange = (mode: SmoothingMode, tension: number) => {
    engineRef.current!.setSmoothingConfig(mode, tension);
    syncSnapshot();
  };

  const handleTriggerScenario = (
    scenario: 'narrow_passage' | 'failure_recovery' | 'dynamic_blockage'
  ) => {
    const eng = engineRef.current!;
    if (scenario === 'narrow_passage') {
      eng.triggerNarrowPassageDemo();
      showFeedback('Loaded Narrow-Passage Conflict demo (R01 vs R02).');
    } else if (scenario === 'failure_recovery') {
      eng.triggerFailureRecoveryDemo();
      showFeedback(
        'Injected fault on carrying robot; custody retained pending recovery handoff.'
      );
    } else {
      eng.triggerDynamicBlockageDemo();
      showFeedback(
        'Placed dynamic obstacle ahead of active robot; smoothed reroute computed.'
      );
    }
    setActiveView('simulator');
    tickTimestampRef.current = performance.now();
    syncSnapshot();
  };

  const handleCellClick = (x: number, y: number) => {
    const eng = engineRef.current!;
    if (tool === 'BLOCK_CELL') {
      const options =
        blockWindowMode === 'PERMANENT'
          ? { delayTicks: 0, durationTicks: null }
          : blockWindowMode === 'TEMP_12'
          ? { delayTicks: 0, durationTicks: 12 }
          : { delayTicks: 3, durationTicks: 12 };
      const reason =
        blockWindowMode === 'PERMANENT'
          ? 'Permanent Block'
          : blockWindowMode === 'TEMP_12'
          ? 'Temp Block (12T)'
          : 'Scheduled Block (+3..+15T)';
      const res = eng.toggleDynamicBlock(x, y, 'USER', reason, options);
      showFeedback(res.message);
      syncSnapshot();
      return;
    }

    if (tool === 'DISPATCH_PICKUP') {
      if (!isCellWalkable(snapshot.warehouse, x, y)) {
        showFeedback(`Cell (${x},${y}) is blocked and cannot be used for jobs.`);
        return;
      }
      if (!pendingPickup) {
        setPendingPickup({ x, y });
        showFeedback(
          `Pickup set at (${x},${y}). Click any open destination cell to dispatch.`
        );
      } else {
        const job = eng.createJob(pendingPickup, { x, y }, 2);
        setPendingPickup(null);
        showFeedback(
          `Queued ${job.id} from (${job.pickup.x},${job.pickup.y}) to (${x},${y}).`
        );
        syncSnapshot();
      }
    }
  };

  const handleUnblockAll = () => {
    const eng = engineRef.current!;
    const coords = [...snapshot.warehouse.dynamicObstacles.values()];
    for (const obs of coords) {
      eng.toggleDynamicBlock(obs.x, obs.y, 'USER');
    }
    showFeedback(`Cleared ${coords.length} dynamic obstacles.`);
    syncSnapshot();
  };

  const handleFailRobot = (robotId: string) => {
    engineRef.current!.failRobot(robotId);
    showFeedback(`Simulated hardware fault on ${robotId}.`);
    syncSnapshot();
  };

  const handleRepairRobot = (robotId: string) => {
    engineRef.current!.repairRobot(robotId);
    showFeedback(`Repaired and restored ${robotId}.`);
    syncSnapshot();
  };

  const handleAddRobot = () => {
    const added = engineRef.current!.addRobot();
    if (added) {
      showFeedback(`Added ${added.id} to fleet.`);
      syncSnapshot();
    }
  };

  const handleAddRandomJob = () => {
    const job = engineRef.current!.createRandomJob();
    showFeedback(`Queued ${job.id} (${job.packageId}).`);
    syncSnapshot();
  };

  const handleCreateCustomJob = (
    pickup: GridCoord,
    drop: GridCoord,
    priority: number,
    customLabel?: string
  ) => {
    const job = engineRef.current!.createJob(
      pickup,
      drop,
      priority,
      customLabel
    );
    showFeedback(
      `Dispatched ${job.id} (${job.packageLabel}) from (${pickup.x},${pickup.y}) → (${drop.x},${drop.y}).`
    );
    syncSnapshot();
  };

  const handleJobModeChange = (mode: JobGenerationMode) => {
    engineRef.current!.setJobMode(mode);
    showFeedback(
      mode === 'AUTO'
        ? 'Job Mode: AUTO (spawns jobs when queue dips below 3).'
        : 'Job Mode: MANUAL (auto-spawning disabled; configure jobs manually).'
    );
    syncSnapshot();
  };

  const handleToggleAutoJobsPlaying = () => {
    const next = !snapshot.autoJobsPlaying;
    engineRef.current!.setAutoJobsPlaying(next);
    showFeedback(
      next ? 'Auto job creation resumed.' : 'Auto job creation paused.'
    );
    syncSnapshot();
  };

  const handleClearPendingJobs = () => {
    const cleared = engineRef.current!.clearPendingJobs();
    showFeedback(`Cleared ${cleared} unassigned pending jobs.`);
    syncSnapshot();
  };

  const toggleLayer = (key: keyof LayerVisibility) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar Contract: 1-line Brand · 4 Nav Links · 1 Primary Action */}
      <header className="h-14 px-6 bg-white border-b border-slate-200 flex items-center justify-between gap-8 shrink-0">
        <a
          href="#simulator"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('simulator');
          }}
          className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          Atlas Fleet Arena
        </a>

        <nav className="flex items-center gap-6 text-sm font-medium">
          {(
            [
              { id: 'simulator', label: 'Simulator' },
              { id: 'analytics', label: 'Analytics' },
              { id: 'ledger', label: 'Event Ledger' },
              { id: 'guide', label: 'Hackathon Guide' },
            ] as { id: AppView; label: string }[]
          ).map((nav) => (
            <button
              key={nav.id}
              type="button"
              onClick={() => setActiveView(nav.id)}
              className={`py-4 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeView === nav.id
                  ? 'border-sky-600 text-slate-900 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              {nav.label}
            </button>
          ))}
        </nav>

        <div className="shrink-0">
          <button
            type="button"
            onClick={() => setShowDispatchModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Dispatch Job
          </button>
        </div>
      </header>

      {/* Main Content Viewport */}
      {activeView === 'simulator' && (
        <div className="flex-1 flex flex-col lg:flex-row min-h-0">
          {/* Left / Center Stage */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {/* Workspace Toolbar */}
            <div className="px-4 py-2.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              {/* Click Interaction Tool Selector */}
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setTool('BLOCK_CELL');
                    setPendingPickup(null);
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    tool === 'BLOCK_CELL'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Ban className="w-3.5 h-3.5 text-red-600" />
                  Block / Unblock Cell
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTool('INSPECT_ROBOT');
                    setPendingPickup(null);
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    tool === 'INSPECT_ROBOT'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Crosshair className="w-3.5 h-3.5 text-sky-600" />
                  Inspect Robot
                </button>
                <button
                  type="button"
                  onClick={() => setTool('DISPATCH_PICKUP')}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    tool === 'DISPATCH_PICKUP'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                  Click Pickup → Drop
                </button>
              </div>

              {tool === 'BLOCK_CELL' && (
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                  {(
                    [
                      { id: 'TEMP_12', label: 'Temp 12T' },
                      { id: 'SCHED_3_15', label: 'Sched +3T' },
                      { id: 'PERMANENT', label: 'Permanent ∞' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setBlockWindowMode(m.id)}
                      className={`px-2 py-1 text-xs font-mono rounded transition-colors whitespace-nowrap ${
                        blockWindowMode === m.id
                          ? 'bg-white text-slate-900 font-semibold shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Canvas Visualization Overlays */}
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={layers.smoothedPaths}
                    onChange={() => toggleLayer('smoothedPaths')}
                    className="accent-sky-600 rounded"
                  />
                  Smoothed Path
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={layers.rawGridPaths}
                    onChange={() => toggleLayer('rawGridPaths')}
                    className="accent-sky-600 rounded"
                  />
                  Raw A* Grid
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={layers.splineControlPoints}
                    onChange={() => toggleLayer('splineControlPoints')}
                    className="accent-sky-600 rounded"
                  />
                  Spline Points
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={layers.reservations}
                    onChange={() => toggleLayer('reservations')}
                    className="accent-sky-600 rounded"
                  />
                  Reservations
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={layers.waitForGraph}
                    onChange={() => toggleLayer('waitForGraph')}
                    className="accent-sky-600 rounded"
                  />
                  Wait-for Graph
                </label>
              </div>
            </div>

            {/* Quiet Status / Telemetry Strip */}
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 text-xs">
              <div className="flex flex-wrap items-center gap-2 font-mono text-slate-600">
                <span className="font-semibold text-slate-900">
                  {snapshot.running ? 'RUNNING' : 'PAUSED'}
                </span>
                <span aria-hidden="true">·</span>
                <span>Tick {snapshot.tick}</span>
                <span aria-hidden="true">·</span>
                <span>
                  Delivered {snapshot.latestMetrics.completedJobs}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Congestion {snapshot.latestMetrics.congestionIndex}%
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Deadlocks Broken {snapshot.latestMetrics.deadlockCount}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Replans {snapshot.latestMetrics.replanCount}
                </span>
              </div>

              {statusMessage && (
                <div className="text-sky-800 font-medium truncate max-w-md">
                  {statusMessage}
                </div>
              )}
            </div>

            {/* Interactive Warehouse Canvas */}
            <div className="flex-1 min-h-0">
              <WarehouseCanvas
                snapshot={snapshot}
                tickTimestampRef={tickTimestampRef}
                tool={tool}
                layers={layers}
                selectedRobotId={selectedRobotId}
                pendingPickupCoord={pendingPickup}
                onCellClick={handleCellClick}
                onSelectRobot={setSelectedRobotId}
              />
            </div>
          </div>

          {/* Right Control & Operations Deck */}
          <div className="w-full lg:w-[370px] xl:w-[400px] shrink-0 lg:h-[calc(100vh-3.5rem)]">
            <ControlDeck
              snapshot={snapshot}
              selectedRobotId={selectedRobotId}
              onToggleRun={handleToggleRun}
              onStepTick={handleStepTick}
              onReset={handleReset}
              onSpeedChange={handleSpeedChange}
              onAllocationChange={handleAllocationChange}
              onJobModeChange={handleJobModeChange}
              onToggleAutoJobsPlaying={handleToggleAutoJobsPlaying}
              onClearPendingJobs={handleClearPendingJobs}
              onOpenDispatchModal={() => setShowDispatchModal(true)}
              onSmoothingChange={handleSmoothingChange}
              onTriggerScenario={handleTriggerScenario}
              onFailRobot={handleFailRobot}
              onRepairRobot={handleRepairRobot}
              onAddRobot={handleAddRobot}
              onAddRandomJob={handleAddRandomJob}
              onSelectRobot={setSelectedRobotId}
              onUnblockAll={handleUnblockAll}
            />
          </div>
        </div>
      )}

      {activeView === 'analytics' && (
        <main className="flex-1 overflow-y-auto">
          <AnalyticsView snapshot={snapshot} />
        </main>
      )}

      {activeView === 'ledger' && (
        <main className="flex-1 overflow-y-auto">
          <EventLedgerView snapshot={snapshot} />
        </main>
      )}

      {activeView === 'guide' && (
        <main className="flex-1 overflow-y-auto">
          <HackathonGuideView onLaunchDemo={handleTriggerScenario} />
        </main>
      )}

      {showDispatchModal && (
        <DispatchJobModal
          warehouse={snapshot.warehouse}
          onClose={() => setShowDispatchModal(false)}
          onCreateJob={handleCreateCustomJob}
        />
      )}
    </div>
  );
}
