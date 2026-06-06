"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  RotateCcw, FolderOpen, Trash2, ZoomIn, RefreshCw, Minus, Plus, X,
} from "lucide-react";
import { rpc, type SystemInfo } from "@/lib/bridge";
import {
  settings, useSettings, DEFAULTS,
  type Settings, type UnresolvedFormat,
} from "@/lib/settings";
import { cn } from "@/lib/cn";

type CacheInfo  = { dir: string; totalBytes: number; fileCount: number };
type SymPath    = { path: string; cacheDir: string };
type SymConfig  = { extraPaths: string[]; includeMsServer: boolean; effectivePath: string };

export default function SettingsView() {
  const cfg = useSettings();
  const [sys, setSys]               = useState<SystemInfo | null>(null);
  const [cache, setCache]           = useState<CacheInfo | null>(null);
  const [symConfig, setSymConfig]   = useState<SymConfig | null>(null);
  const [clearing, setClearing]     = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [newPath, setNewPath]       = useState("");

  const refreshCache = useCallback(async () => {
    try {
      const info = await rpc.call<CacheInfo>("symbols.cacheInfo");
      setCache(info);
    } catch { /* swallow */ }
  }, []);

  const refreshSymConfig = useCallback(async () => {
    try {
      const sc = await rpc.call<SymConfig>("symbols.getConfig");
      setSymConfig(sc);
    } catch { /* swallow */ }
  }, []);

  useEffect(() => {
    rpc.call<SystemInfo>("system.info").then(setSys).catch(() => {});
    void refreshCache();
    void refreshSymConfig();
  }, [refreshCache, refreshSymConfig]);

  useEffect(() => {
    rpc.call("system.setZoom", { factor: cfg.zoomFactor }).catch(() => {});
  }, [cfg.zoomFactor]);

  async function commitSym(nextPaths: string[], nextMsServer: boolean) {
    settings.set("symbolExtraPaths",      nextPaths);
    settings.set("symbolIncludeMsServer", nextMsServer);
    try {
      const sc = await rpc.call<SymConfig>("symbols.setConfig", {
        extraPaths: nextPaths,
        includeMsServer: nextMsServer,
      });
      setSymConfig(sc);
    } catch { /* swallow */ }
  }

  function addNewPath() {
    const p = newPath.trim();
    if (!p) return;
    if (cfg.symbolExtraPaths.includes(p)) { setNewPath(""); return; }
    void commitSym([...cfg.symbolExtraPaths, p], cfg.symbolIncludeMsServer);
    setNewPath("");
  }
  function removePath(idx: number) {
    void commitSym(cfg.symbolExtraPaths.filter((_, i) => i !== idx), cfg.symbolIncludeMsServer);
  }
  function movePath(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= cfg.symbolExtraPaths.length) return;
    const next = cfg.symbolExtraPaths.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    void commitSym(next, cfg.symbolIncludeMsServer);
  }

  async function clearCache() {
    setClearing(true);
    try {
      await rpc.call<CacheInfo>("symbols.clearCache");
      await refreshCache();
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <Section title="Capture" description="Defaults applied when starting a new sampler session.">
          <NumberRow
            label="Sampling rate"
            description="Target frequency per thread. Effective rate is capped by stackwalk time on slow targets."
            value={cfg.defaultSamplingHz}
            min={1}  max={4000}  step={50}  unit="Hz"
            onChange={(v) => settings.set("defaultSamplingHz", v)}
            defaultValue={DEFAULTS.defaultSamplingHz}
          />
          <NumberRow
            label="Max stack depth"
            description="Frames per sample. Lower for very deep targets to cap memory; higher for templated C++."
            value={cfg.defaultMaxDepth}
            min={4}  max={64}  step={1}
            onChange={(v) => settings.set("defaultMaxDepth", v)}
            defaultValue={DEFAULTS.defaultMaxDepth}
          />
          <NumberRow
            label="Auto-stop after"
            description="0 = capture until you press Stop. Otherwise stops the sampler automatically."
            value={cfg.defaultDurationMs}
            min={0}  max={600000}  step={500}  unit="ms"
            onChange={(v) => settings.set("defaultDurationMs", v)}
            defaultValue={DEFAULTS.defaultDurationMs}
          />
          <ToggleRow
            label="Auto-pick top CPU thread after Stop"
            description="When off, the analysis tabs default to All threads until you pick one."
            value={cfg.autoPickTopThread}
            onChange={(v) => settings.set("autoPickTopThread", v)}
          />
        </Section>

        <Section title="Symbols" description="Search locations passed to DbgHelp. Re-attach the target process for changes to take effect.">
          <RowFrame
            label="Extra paths"
            description={"Prepended to the search path in this order. Use a local directory for downstream PDBs (e.g. \"C:\\\\sym\"), or an srv* entry to add another symbol server."}
          >
            <div className="space-y-1.5">
              {cfg.symbolExtraPaths.length === 0 && (
                <div className="text-[11px] text-white/35 font-mono italic px-1 py-1">
                  No extra paths.
                </div>
              )}
              <AnimatePresence initial={false}>
                {cfg.symbolExtraPaths.map((p, i) => (
                  <motion.div
                    key={p}
                    layout
                    initial={{ opacity: 0, height: 0, y: -4 }}
                    animate={{ opacity: 1, height: "auto", y: 0 }}
                    exit={{ opacity: 0, height: 0, y: -4, transition: { duration: 0.15 } }}
                    transition={{
                      opacity: { duration: 0.18 },
                      height:  { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
                      y:       { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
                      layout:  { type: "spring", stiffness: 420, damping: 38 },
                    }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-1">
                      <div className="font-mono text-[10px] text-white/30 w-5 text-right tabular-nums select-none">{i + 1}.</div>
                      <pre className="flex-1 font-mono text-[11px] text-white/80 bg-black/40 border border-[var(--border)] rounded px-2 py-1 break-all whitespace-pre-wrap selectable">
                        {p}
                      </pre>
                      <button
                        onClick={() => movePath(i, -1)}
                        disabled={i === 0}
                        className="text-white/40 hover:text-white disabled:opacity-25 disabled:cursor-default px-1"
                        title="Move up"
                      >▲</button>
                      <button
                        onClick={() => movePath(i, +1)}
                        disabled={i === cfg.symbolExtraPaths.length - 1}
                        className="text-white/40 hover:text-white disabled:opacity-25 disabled:cursor-default px-1"
                        title="Move down"
                      >▼</button>
                      <button
                        onClick={() => removePath(i)}
                        className="text-white/40 hover:text-rose-300 px-1"
                        title="Remove"
                      ><X size={12} /></button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              <div className="flex items-center gap-2 pt-1">
                <input
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addNewPath(); }}
                  placeholder="C:\sym  or  srv*C:\sym*https://example.com/symbols"
                  className="flex-1 bg-black/40 border border-[var(--border)] rounded px-2 py-1 text-[11px] font-mono outline-none selectable"
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  className="btn !py-1 !px-2 !text-[11px]"
                  onClick={addNewPath}
                  disabled={!newPath.trim()}
                >
                  <Plus size={11} /> Add
                </button>
              </div>
            </div>
          </RowFrame>
          <ToggleRow
            label="Microsoft public symbol server"
            description={"Appends srv*<cache>*https://msdl.microsoft.com/download/symbols so DbgHelp downloads OS PDBs on demand. Disable for offline use. Ignored if _NT_SYMBOL_PATH is set in the environment."}
            value={cfg.symbolIncludeMsServer}
            onChange={(v) => commitSym(cfg.symbolExtraPaths, v)}
          />
          <RowFrame
            label="Effective path"
            description="What SymInitialize will actually receive on the next attach."
          >
            <pre className="font-mono text-[11px] text-white/65 bg-black/40 border border-[var(--border)] rounded px-2 py-1.5 break-all whitespace-pre-wrap selectable">
              {symConfig?.effectivePath || "—"}
            </pre>
          </RowFrame>
          <RowFrame label="Cache directory" description="Local store for downloaded PDBs.">
            <div className="flex items-center gap-2">
              <pre className="font-mono text-[11px] text-white/65 bg-black/40 border border-[var(--border)] rounded px-2 py-1.5 break-all flex-1 selectable">
                {cache?.dir ?? "—"}
              </pre>
              <button
                className="btn !py-1 !px-2 !text-[11px]"
                onClick={() => cache && rpc.call("system.openInExplorer", { path: cache.dir })}
                disabled={!cache}
                title="Open in Explorer"
              >
                <FolderOpen size={11} /> Open
              </button>
            </div>
            <div className="font-mono text-[11px] text-white/55 mt-2 flex items-center gap-3">
              <span>
                {cache ? `${cache.fileCount.toLocaleString()} files` : "—"}
                {cache && <> · {formatBytes(cache.totalBytes)}</>}
              </span>
              <button
                className="btn !py-1 !px-2 !text-[11px]"
                onClick={refreshCache}
                title="Recount cache files"
              >
                <RefreshCw size={11} /> Refresh
              </button>
              <button
                className="btn btn-danger !py-1 !px-2 !text-[11px] ml-auto"
                onClick={clearCache}
                disabled={!cache || cache.fileCount === 0 || clearing}
                title="Delete every file inside the cache directory"
              >
                <Trash2 size={11} /> {clearing ? "Clearing…" : "Clear cache"}
              </button>
            </div>
          </RowFrame>
        </Section>

        <Section title="Analysis" description="Defaults pushed to backend RPCs when querying aggregations.">
          <NumberRow
            label="Flat profile top N"
            description="Maximum number of functions returned per query in the Flat / Source tabs."
            value={cfg.flatTopN}
            min={20}  max={5000}  step={10}
            onChange={(v) => settings.set("flatTopN", v)}
            defaultValue={DEFAULTS.flatTopN}
          />
          <NumberRow
            label="Call tree max depth"
            description="Trees are pruned beyond this depth. Lower for crowded views."
            value={cfg.callTreeMaxDepth}
            min={4}  max={128}  step={1}
            onChange={(v) => settings.set("callTreeMaxDepth", v)}
            defaultValue={DEFAULTS.callTreeMaxDepth}
          />
          <NumberRow
            label="Call tree min samples"
            description="Nodes with fewer total samples than this are pruned. 1 keeps everything."
            value={cfg.callTreeMinSamples}
            min={1}  max={10000}  step={1}
            onChange={(v) => settings.set("callTreeMinSamples", v)}
            defaultValue={DEFAULTS.callTreeMinSamples}
          />
          <NumberRow
            label="Source context lines"
            description="Lines of context shown above and below the hot region in the Source tab."
            value={cfg.sourceContextLines}
            min={0}  max={200}  step={1}
            onChange={(v) => settings.set("sourceContextLines", v)}
            defaultValue={DEFAULTS.sourceContextLines}
          />
          <NumberRow
            label="Disassembly default bytes"
            description="Initial byte count read from the target when you click a function."
            value={cfg.disasmDefaultBytes}
            min={64}  max={4096}  step={64}
            onChange={(v) => settings.set("disasmDefaultBytes", v)}
            defaultValue={DEFAULTS.disasmDefaultBytes}
          />
        </Section>

        <Section title="Display" description="UI rendering options. Applied immediately.">
          <RowFrame
            label="Zoom factor"
            description="Scales the whole UI proportionally. Common values: 1.00, 1.25, 1.50."
          >
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1">
                {[1.0, 1.25, 1.5, 2.0].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => settings.set("zoomFactor", preset)}
                    className={cn(
                      "px-2 py-1 rounded border text-[11px] font-mono tabular-nums",
                      Math.abs(cfg.zoomFactor - preset) < 0.005
                        ? "bg-white text-black border-white"
                        : "bg-black/40 border-[var(--border)] text-white/65 hover:bg-white/[0.05]",
                    )}
                  >
                    {(preset * 100).toFixed(0)}%
                  </button>
                ))}
              </div>
              <NumberStepper
                value={cfg.zoomFactor}
                min={0.5} max={3.0} step={0.05}
                onChange={(v) => settings.set("zoomFactor", v)}
                formatDisplay={(v) => `${v.toFixed(2)}×`}
                ariaLabel="Zoom factor"
              />
              <button
                className={cn(
                  "btn !py-1 !px-2 !text-[11px] ml-auto",
                  cfg.zoomFactor === DEFAULTS.zoomFactor && "opacity-40 cursor-default",
                )}
                onClick={() => settings.set("zoomFactor", DEFAULTS.zoomFactor)}
                disabled={cfg.zoomFactor === DEFAULTS.zoomFactor}
                title={`Reset to ${DEFAULTS.zoomFactor}×`}
              >
                <RotateCcw size={11} /> Reset
              </button>
            </div>
          </RowFrame>
          <SelectRow<UnresolvedFormat>
            label="Format unresolved frames as"
            description="How frames without PDB symbols are displayed."
            value={cfg.unresolvedFormat}
            options={[
              { value: "sub",  label: "sub_HEXADDR  (IDA-style, default)" },
              { value: "hex",  label: "0xHEXADDR" },
              { value: "hide", label: "Hide them" },
            ]}
            onChange={(v) => settings.set("unresolvedFormat", v)}
          />
        </Section>

        <div className="pt-2">
          {resetConfirm ? (
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-amber-300/80 font-mono">
                Reset every UI setting to the built-in defaults?
              </span>
              <button
                className="btn btn-danger !py-1 !px-2 !text-[11px]"
                onClick={() => { settings.reset(); setResetConfirm(false); }}
              >
                Yes, reset
              </button>
              <button
                className="btn !py-1 !px-2 !text-[11px]"
                onClick={() => setResetConfirm(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              className="btn !py-1 !px-2 !text-[11px]"
              onClick={() => setResetConfirm(true)}
            >
              <RotateCcw size={11} /> Reset all settings to defaults
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title, description, children,
}: {
  title: string; description?: string; children: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="px-5 pt-4 pb-3 border-b border-[var(--border)]">
        <p className="label">{title}</p>
        {description && (
          <p className="text-[11px] text-white/45 mt-1">{description}</p>
        )}
      </div>
      <div className="divide-y divide-white/[0.04]">
        {children}
      </div>
    </section>
  );
}

function RowFrame({
  label, description, children,
}: {
  label: string; description?: string; children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-3">
      <div className="grid grid-cols-1 sm:grid-cols-[260px_1fr] gap-3 items-start">
        <div className="min-w-0">
          <div className="text-[12px] text-white/90">{label}</div>
          {description && (
            <div className="text-[11px] text-white/45 mt-0.5 leading-snug">{description}</div>
          )}
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}

function NumberRow({
  label, description, value, min, max, step, unit, onChange, defaultValue,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
  defaultValue: number;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const decimals = Math.max(0, (step.toString().split(".")[1] ?? "").length);
  const round = (v: number) => decimals > 0 ? Number(v.toFixed(decimals)) : Math.round(v);

  return (
    <RowFrame label={label} description={description}>
      <div className="flex items-center gap-2">
        <div className="flex items-stretch border border-[var(--border)] rounded bg-black/40 overflow-hidden">
          <StepperBtn
            disabled={value <= min}
            onClick={() => onChange(clamp(round(value - step)))}
            ariaLabel="Decrease"
          >
            <Minus size={11} />
          </StepperBtn>
          <input
            type="number"
            min={min}  max={max}  step={step}
            value={value}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v)) return;
              onChange(clamp(v));
            }}
            className="w-20 text-center bg-transparent px-1 py-1 text-[12px] font-mono outline-none selectable border-x border-[var(--border)]"
          />
          <StepperBtn
            disabled={value >= max}
            onClick={() => onChange(clamp(round(value + step)))}
            ariaLabel="Increase"
          >
            <Plus size={11} />
          </StepperBtn>
        </div>
        {unit && <span className="font-mono text-[11px] text-white/40">{unit}</span>}
        <button
          className={cn(
            "btn !py-1 !px-2 !text-[11px] ml-auto",
            value === defaultValue && "opacity-40 cursor-default",
          )}
          onClick={() => onChange(defaultValue)}
          disabled={value === defaultValue}
          title={`Reset to ${defaultValue}${unit ? ` ${unit}` : ""}`}
        >
          <RotateCcw size={11} />
        </button>
      </div>
    </RowFrame>
  );
}

function NumberStepper({
  value, min, max, step, onChange, formatDisplay, ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  formatDisplay?: (v: number) => string;
  ariaLabel?: string;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const decimals = Math.max(0, (step.toString().split(".")[1] ?? "").length);
  const round = (v: number) => decimals > 0 ? Number(v.toFixed(decimals)) : Math.round(v);
  const display = formatDisplay ? formatDisplay(value) : String(value);

  return (
    <div
      className="flex items-stretch border border-[var(--border)] rounded bg-black/40 overflow-hidden"
      role="group" aria-label={ariaLabel}
    >
      <StepperBtn
        disabled={value <= min}
        onClick={() => onChange(clamp(round(value - step)))}
        ariaLabel={`Decrease ${ariaLabel ?? "value"}`}
      >
        <Minus size={11} />
      </StepperBtn>
      <div className="px-3 flex items-center justify-center min-w-[64px] text-[12px] font-mono tabular-nums border-x border-[var(--border)] select-none">
        {display}
      </div>
      <StepperBtn
        disabled={value >= max}
        onClick={() => onChange(clamp(round(value + step)))}
        ariaLabel={`Increase ${ariaLabel ?? "value"}`}
      >
        <Plus size={11} />
      </StepperBtn>
    </div>
  );
}

function StepperBtn({
  children, onClick, disabled, ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "px-1.5 flex items-center justify-center text-white/55 hover:text-white hover:bg-white/[0.06]",
        "active:bg-white/[0.12] transition-colors",
        disabled && "opacity-30 cursor-default hover:bg-transparent",
      )}
    >
      {children}
    </button>
  );
}

function ToggleRow({
  label, description, value, onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <RowFrame label={label} description={description}>
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-white"
        />
        <span className="text-[12px] text-white/75">{value ? "Enabled" : "Disabled"}</span>
      </label>
    </RowFrame>
  );
}

function SelectRow<T extends string>({
  label, description, value, options, onChange,
}: {
  label: string;
  description?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <RowFrame label={label} description={description}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="bg-black/40 border border-[var(--border)] rounded px-2 py-1 text-[12px] font-mono outline-none cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </RowFrame>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-2 grid grid-cols-[260px_1fr] gap-3 items-baseline">
      <div className="text-[12px] text-white/55">{label}</div>
      <div className="font-mono text-[12px] text-white/85 selectable break-all">{value}</div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
