import React, { useState } from 'react';
import { X } from 'lucide-react';
import { GridCoord, WarehouseLayout } from '../engine/types';
import { isCellWalkable } from '../engine/warehouseManager';

interface DispatchJobModalProps {
  warehouse: WarehouseLayout;
  onClose: () => void;
  onCreateJob: (
    pickup: GridCoord,
    drop: GridCoord,
    priority: number,
    customLabel?: string
  ) => void;
}

export const DispatchJobModal: React.FC<DispatchJobModalProps> = ({
  warehouse,
  onClose,
  onCreateJob,
}) => {
  const pickups = warehouse.pickupStations;
  const drops = warehouse.dropStations;

  const [itemLabel, setItemLabel] = useState('');
  const [pickupMode, setPickupMode] = useState<'station' | 'custom'>('station');
  const [dropMode, setDropMode] = useState<'station' | 'custom'>('station');
  const [pickupIdx, setPickupIdx] = useState(0);
  const [dropIdx, setDropIdx] = useState(0);
  const [customPickupX, setCustomPickupX] = useState(
    pickups[0]?.coord.x ?? 0
  );
  const [customPickupY, setCustomPickupY] = useState(
    pickups[0]?.coord.y ?? 0
  );
  const [customDropX, setCustomDropX] = useState(drops[0]?.coord.x ?? 0);
  const [customDropY, setCustomDropY] = useState(drops[0]?.coord.y ?? 0);
  const [priority, setPriority] = useState(2);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const pCoord =
      pickupMode === 'station'
        ? pickups[pickupIdx]?.coord
        : { x: customPickupX, y: customPickupY };
    const dCoord =
      dropMode === 'station'
        ? drops[dropIdx]?.coord
        : { x: customDropX, y: customDropY };

    if (!pCoord || !dCoord) return;

    if (!isCellWalkable(warehouse, pCoord.x, pCoord.y)) {
      setErrorMsg(
        `Pickup cell (${pCoord.x}, ${pCoord.y}) is blocked or out of bounds.`
      );
      return;
    }
    if (!isCellWalkable(warehouse, dCoord.x, dCoord.y)) {
      setErrorMsg(
        `Drop cell (${dCoord.x}, ${dCoord.y}) is blocked or out of bounds.`
      );
      return;
    }
    if (pCoord.x === dCoord.x && pCoord.y === dCoord.y) {
      setErrorMsg('Pickup and drop locations must be different cells.');
      return;
    }

    onCreateJob(pCoord, dCoord, priority, itemLabel);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Configure &amp; Dispatch Delivery Job
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {/* Item / Cargo Description */}
          <div className="space-y-1.5">
            <label
              htmlFor="item-label-input"
              className="block font-medium text-slate-700"
            >
              Cargo / Item to Pick (Optional)
            </label>
            <input
              id="item-label-input"
              type="text"
              value={itemLabel}
              onChange={(e) => setItemLabel(e.target.value)}
              placeholder="e.g., Electronics Tray, Medical Kit"
              maxLength={32}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 placeholder:text-slate-400"
            />
          </div>

          {/* Pickup Location */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="pickup-select"
                className="block font-medium text-slate-700"
              >
                Pickup From
              </label>
              <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded">
                <button
                  type="button"
                  onClick={() => setPickupMode('station')}
                  className={`px-2 py-0.5 text-[11px] rounded ${
                    pickupMode === 'station'
                      ? 'bg-white text-slate-900 font-medium shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Dock
                </button>
                <button
                  type="button"
                  onClick={() => setPickupMode('custom')}
                  className={`px-2 py-0.5 text-[11px] rounded ${
                    pickupMode === 'custom'
                      ? 'bg-white text-slate-900 font-medium shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Custom (x,y)
                </button>
              </div>
            </div>

            {pickupMode === 'station' ? (
              <select
                id="pickup-select"
                value={pickupIdx}
                onChange={(e) => setPickupIdx(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 font-mono"
              >
                {pickups.map((p, idx) => (
                  <option key={p.id} value={idx}>
                    {p.label} ({p.coord.x}, {p.coord.y})
                  </option>
                ))}
              </select>
            ) : (
              <div className="grid grid-cols-2 gap-2 font-mono">
                <label className="flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-1.5">
                  <span className="text-slate-500">X:</span>
                  <input
                    type="number"
                    min={0}
                    max={warehouse.cols - 1}
                    value={customPickupX}
                    onChange={(e) => setCustomPickupX(Number(e.target.value))}
                    className="w-full focus:outline-none text-slate-900"
                  />
                </label>
                <label className="flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-1.5">
                  <span className="text-slate-500">Y:</span>
                  <input
                    type="number"
                    min={0}
                    max={warehouse.rows - 1}
                    value={customPickupY}
                    onChange={(e) => setCustomPickupY(Number(e.target.value))}
                    className="w-full focus:outline-none text-slate-900"
                  />
                </label>
              </div>
            )}
          </div>

          {/* Drop Location */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="drop-select"
                className="block font-medium text-slate-700"
              >
                Drop At
              </label>
              <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded">
                <button
                  type="button"
                  onClick={() => setDropMode('station')}
                  className={`px-2 py-0.5 text-[11px] rounded ${
                    dropMode === 'station'
                      ? 'bg-white text-slate-900 font-medium shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Dock
                </button>
                <button
                  type="button"
                  onClick={() => setDropMode('custom')}
                  className={`px-2 py-0.5 text-[11px] rounded ${
                    dropMode === 'custom'
                      ? 'bg-white text-slate-900 font-medium shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Custom (x,y)
                </button>
              </div>
            </div>

            {dropMode === 'station' ? (
              <select
                id="drop-select"
                value={dropIdx}
                onChange={(e) => setDropIdx(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 font-mono"
              >
                {drops.map((d, idx) => (
                  <option key={d.id} value={idx}>
                    {d.label} ({d.coord.x}, {d.coord.y})
                  </option>
                ))}
              </select>
            ) : (
              <div className="grid grid-cols-2 gap-2 font-mono">
                <label className="flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-1.5">
                  <span className="text-slate-500">X:</span>
                  <input
                    type="number"
                    min={0}
                    max={warehouse.cols - 1}
                    value={customDropX}
                    onChange={(e) => setCustomDropX(Number(e.target.value))}
                    className="w-full focus:outline-none text-slate-900"
                  />
                </label>
                <label className="flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-1.5">
                  <span className="text-slate-500">Y:</span>
                  <input
                    type="number"
                    min={0}
                    max={warehouse.rows - 1}
                    value={customDropY}
                    onChange={(e) => setCustomDropY(Number(e.target.value))}
                    className="w-full focus:outline-none text-slate-900"
                  />
                </label>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <span className="block font-medium text-slate-700">
              Dispatch Priority
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { val: 1, label: 'Standard (1)' },
                { val: 2, label: 'High (2)' },
                { val: 3, label: 'Urgent (3)' },
              ].map((opt) => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => setPriority(opt.val)}
                  className={`py-2 px-3 rounded-lg border text-xs font-medium transition-colors ${
                    priority === opt.val
                      ? 'bg-sky-50 border-sky-500 text-sky-800'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {errorMsg && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {errorMsg}
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg"
            >
              Queue Job
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
