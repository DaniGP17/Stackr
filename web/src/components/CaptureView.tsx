"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Square, Link2, Unlink, RefreshCw, Save, FolderOpen } from "lucide-react";
import ProcessPicker from "./ProcessPicker";
import LaunchDialog from "./LaunchDialog";
import DisassemblyView from "./DisassemblyView";
import {
  rpc,
  type ProcessInfo,
  type AttachResult,
  type LaunchResult,
  type SamplerStats,
  type FlatProfile,
  type FlatEntry,
} from "@/lib/bridge";
import { useAnimatedNumber, useLiveElapsed } from "@/lib/useAnimatedNumber";
import { settings, useSettings, readSettings } from "@/lib/settings";
import { aliasKey, resolveAlias, saveAlias } from "@/lib/aliases";
import { Select } from "./Select";

export default function CaptureView({
  onAttachedPid,
}: {
  onAttachedPid?: (pid: number | null) => void;
} = {}) {
  const [target, setTarget]         = useState<ProcessInfo | null>(null);
  const [attachedPid, setAttachedRaw] = useState<number | null>(null);
  const setAttached = (v: number | null) => {
    setAttachedRaw(v);
    onAttachedPid?.(v);
  };
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [stats, setStats]           = useState<SamplerStats | null>(null);
  const [freqHz, setFreqHz]         = useState(() => readSettings().defaultSamplingHz);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [profile, setProfile]       = useState<FlatProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [selectedTid, setSelectedTid] = useState<number | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<FlatEntry | null>(null);
  const [disasmRatio, setDisasmRatio] = useState(0.4);
  const splitRef = useRef<HTMLDivElement>(null);

  function onSplitterDown(ev: React.MouseEvent) {
    ev.preventDefault();
    const onMove = (e: MouseEvent) => {
      const rect = splitRef.current?.getBoundingClientRect();
      if (!rect) return;
      const disasmWidth = rect.right - e.clientX;
      const next = disasmWidth / rect.width;
      setDisasmRatio(Math.max(0.4, Math.min(0.6, next)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const capturing = stats?.running ?? false;
  const prevCapturingRef = useRef(capturing);

  useEffect(() => {
    if (prevCapturingRef.current && !capturing && attachedPid != null) {
      void autoFetchAfterStop(attachedPid);
    }
    if (!prevCapturingRef.current && capturing) {
      setAutoFollow(true);
    }
    prevCapturingRef.current = capturing;
  }, [capturing, attachedPid]);

  useEffect(() => {
    setProfile(null);
    setSelectedTid(null);
    setSelectedEntry(null);
  }, [attachedPid]);

  async function loadProfile(pid: number, tid: number | null, rebuild: boolean) {
    setProfileLoading(true);
    try {
      const params: Record<string, unknown> = { pid, topN: 200, rebuild };
      if (tid != null) params.tid = tid;
      const p = await rpc.call<FlatProfile>("analysis.flatProfile", params);
      setProfile(p);
      return p;
    } catch {
      return null;
    } finally {
      setProfileLoading(false);
    }
  }

  async function autoFetchAfterStop(pid: number) {
    const all = await loadProfile(pid, null, true);
    if (all && all.threads.length > 0) {
      const topTid = all.threads[0].tid;
      setSelectedTid(topTid);
      await loadProfile(pid, topTid, false);
    }
  }

  function changeSelectedTid(tid: number | null) {
    setSelectedTid(tid);
    setAutoFollow(false);
    if (attachedPid != null && !capturing) {
      void loadProfile(attachedPid, tid, false);
    }
  }

  useEffect(() => {
    if (!capturing || attachedPid == null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled || attachedPid == null) return;
      try {
        const params: Record<string, unknown> = {
          pid: attachedPid,
          topN: readSettings().flatTopN,
          rebuild: true,
        };
        if (selectedTid != null) params.tid = selectedTid;
        const p = await rpc.call<FlatProfile>("analysis.flatProfile", params);
        if (cancelled) return;
        setProfile(p);

        if (autoFollow && p.threads.length > 0) {
          const top = p.threads[0].tid;
          if (top !== selectedTid) setSelectedTid(top);
        }
      } catch {
      }
      if (!cancelled) timer = setTimeout(poll, 1500);
    };

    timer = setTimeout(poll, 700);
    return () => {
      cancelled = true;
      if (timer != null) clearTimeout(timer);
    };
  }, [capturing, attachedPid, selectedTid, autoFollow]);

  useEffect(() => {
    const offProgress = rpc.on("sampler.progress", (payload) => {
      const p = payload as Partial<SamplerStats>;
      setStats((prev) => ({
        ...(prev ?? defaultStats(attachedPid ?? 0, freqHz)),
        ...p,
        running: true,
      }));
    });
    const offStopped = rpc.on("sampler.stopped", (payload) => {
      const p = payload as Partial<SamplerStats>;
      setStats((prev) => ({
        ...(prev ?? defaultStats(attachedPid ?? 0, freqHz)),
        ...p,
        running: false,
      }));
    });
    return () => {
      offProgress();
      offStopped();
    };
  }, [attachedPid, freqHz]);

  async function attach(p: ProcessInfo) {
    setBusy(true); setError(null);
    try {
      const r = await rpc.call<AttachResult>("process.attach", { pid: p.pid });
      if (r.attached) {
        setTarget(p);
        setAttached(p.pid);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function detach() {
    if (attachedPid == null) return;
    if (capturing) await stopSampler();
    setBusy(true); setError(null);
    try {
      await rpc.call("process.detach", { pid: attachedPid });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAttached(null);
      setStats(null);
      setBusy(false);
    }
  }

  async function startSampler() {
    if (attachedPid == null) return;
    setBusy(true); setError(null);
    try {
      const cfg = readSettings();
      const params: Record<string, unknown> = {
        pid: attachedPid,
        frequencyHz: freqHz,
        maxDepth: cfg.defaultMaxDepth,
      };
      if (cfg.defaultDurationMs > 0) params.durationMs = cfg.defaultDurationMs;
      const s = await rpc.call<SamplerStats>("sampler.start", params);
      setStats(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function stopSampler() {
    setBusy(true); setError(null);
    try {
      const s = await rpc.call<SamplerStats>("sampler.stop");
      setStats(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveCapture() {
    setBusy(true); setError(null);
    try {
      const r = await rpc.call<{ cancelled?: boolean; path?: string; sampleCount?: number }>(
        "capture.save", {}
      );
      if (r.cancelled) return;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openCapture() {
    setBusy(true); setError(null);
    try {
      const r = await rpc.call<{
        cancelled?: boolean;
        pid?: number;
        sampleCount?: number;
        elapsedMs?: number;
        path?: string;
      }>("capture.load", {});
      if (r.cancelled || r.pid == null) return;
      const fileName = (r.path ?? "").replace(/.*[\\/]/, "") || "capture";
      const synthetic: ProcessInfo = {
        pid: r.pid,
        parentPid: 0,
        name: fileName,
        path: r.path ?? "",
        threads: 0,
        sessionId: 0,
        bitness: "x64",
        elevated: false,
        accessible: true,
      };
      setTarget(synthetic);
      setAttached(r.pid);
      void autoFetchAfterStop(r.pid);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onLaunched(r: LaunchResult, path: string) {
    const name = path.split(/[\\/]/).pop() ?? path;
    const synthetic: ProcessInfo = {
      pid: r.pid,
      parentPid: 0,
      name,
      path,
      threads: 1,
      sessionId: 0,
      bitness: "x64",
      elevated: false,
      accessible: true,
    };
    setTarget(synthetic);
    setAttached(r.pid);
  }

  return (
    <div className="h-full grid grid-cols-[minmax(0,1fr)_420px] grid-rows-1 gap-4 p-4">
      <div className="flex flex-col gap-4 min-w-0 min-h-0">
        <div className="card p-5">
          <p className="label">CAPTURE</p>
          <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-3">
            <div className="min-w-0 flex-1" style={{ minWidth: "14rem" }}>
              <h1 className="heading-lg truncate">
                {target ? target.name : "No target selected"}
              </h1>
              <p className="text-[12px] text-white/40 mt-1 font-mono truncate">
                {target
                  ? `PID ${target.pid} · ${target.threads} thr · ${target.bitness}${target.path ? ` · ${target.path}` : ""}`
                  : "Pick a process from the right panel or launch a new executable"}
              </p>
              {error && (
                <p className="text-[12px] text-red-300/80 font-mono mt-1.5 break-all">{error}</p>
              )}
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <label className="flex items-center gap-2 text-[12px] text-white/50" title="Target per-thread sampling rate. Effective rate is capped by stack-walk time (~45ms / cycle), so rates above ~22 Hz behave the same on slow targets.">
                <span className="label">RATE</span>
                <input
                  type="number"
                  min={1}
                  max={4000}
                  step={1}
                  value={freqHz}
                  onChange={(e) => setFreqHz(Math.max(1, Number(e.target.value)))}
                  disabled={capturing}
                  className="w-20 bg-black/40 border border-[var(--border)] rounded px-2 py-1 text-[12px] font-mono outline-none selectable disabled:opacity-50"
                />
                <span className="font-mono text-[11px] text-white/30">Hz</span>
              </label>

              {attachedPid == null ? (
                <button
                  className="btn"
                  onClick={() => target && attach(target)}
                  disabled={!target || busy}
                >
                  <Link2 size={13} />
                  Attach
                </button>
              ) : (
                <button className="btn" onClick={detach} disabled={busy}>
                  <Unlink size={13} />
                  Detach
                </button>
              )}

              {!capturing ? (
                <button
                  className="btn btn-primary"
                  disabled={attachedPid == null || busy}
                  onClick={startSampler}
                >
                  <Play size={13} fill="currentColor" />
                  Start
                </button>
              ) : (
                <button className="btn btn-danger" onClick={stopSampler} disabled={busy}>
                  <Square size={13} fill="currentColor" />
                  Stop
                </button>
              )}

              <div className="w-px h-5 bg-white/10 shrink-0" />

              <button
                className="btn !py-1 !px-2 !text-[11px]"
                onClick={saveCapture}
                disabled={busy || capturing || attachedPid == null}
                title="Save capture to .stackr file"
              >
                <Save size={12} />
                Save
              </button>
              <button
                className="btn !py-1 !px-2 !text-[11px]"
                onClick={openCapture}
                disabled={busy || capturing}
                title="Open a .stackr capture file"
              >
                <FolderOpen size={12} />
                Open
              </button>
            </div>
          </div>

          {stats && <StatsRow stats={stats} running={capturing} />}
        </div>

        <div
          ref={splitRef}
          className="flex-1 min-h-0 grid grid-rows-1"
          style={{
            gridTemplateColumns:
              selectedEntry && attachedPid != null
                ? `minmax(0, ${1 - disasmRatio}fr) 12px minmax(0, ${disasmRatio}fr)`
                : "minmax(0, 1fr)",
            columnGap: selectedEntry && attachedPid != null ? "0px" : "1rem",
          }}
        >
          <div className="card p-5 flex flex-col min-w-0 min-h-0">
            <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
              <p className="label flex items-center gap-2">
                HOT FUNCTIONS
                {capturing && (
                  <span className="inline-flex items-center gap-1 text-rose-300/90 normal-case tracking-normal text-[9px] font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                    LIVE
                  </span>
                )}
              </p>
              <div className="flex items-center gap-3">
                {profile && (
                  <span className="font-mono text-[10px] text-white/40">
                    {profile.samplesTotal.toLocaleString()} samples · {profile.entryCount.toLocaleString()} fns · {profile.elapsedMs} ms
                  </span>
                )}
                {profile && profile.threads.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <ThreadDropdown
                      threads={profile.threads}
                      selectedTid={selectedTid}
                      onSelect={changeSelectedTid}
                      disabled={profileLoading}
                    />
                    {capturing && autoFollow && (
                      <span
                        className="text-[9px] font-mono text-emerald-300/90 px-1.5 py-0.5 border border-emerald-400/35 rounded"
                        title="The filter is tracking the top CPU thread automatically. Pick any TID from the dropdown to take over."
                      >
                        AUTO
                      </span>
                    )}
                  </div>
                )}
                {attachedPid != null && (
                  <button
                    className="btn !py-1 !px-2 !text-[11px]"
                    onClick={() => loadProfile(attachedPid, selectedTid, true)}
                    disabled={profileLoading || capturing}
                    title="Re-aggregate the latest capture"
                  >
                    <RefreshCw size={11} className={profileLoading ? "animate-spin" : ""} />
                    Rebuild
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              <HotFunctionsTable
                profile={profile}
                loading={profileLoading}
                capturing={capturing}
                hasTarget={attachedPid != null}
                selectedAddr={selectedEntry?.addr ?? null}
                onSelect={setSelectedEntry}
              />
            </div>
          </div>

          <AnimatePresence>
            {selectedEntry && attachedPid != null && (
              <motion.div
                key="splitter"
                role="separator"
                aria-orientation="vertical"
                onMouseDown={onSplitterDown}
                className="cursor-col-resize relative group select-none"
                title="Drag to resize (40 % – 60 %)"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[3px] rounded-sm bg-white/[0.06] group-hover:bg-white/25 group-active:bg-white/35 transition-colors" />
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence mode="wait">
            {selectedEntry && attachedPid != null && (
              <motion.div
                key={`disasm-${selectedEntry.addr}`}
                className="min-w-0 min-h-0"
                initial={{ opacity: 0, x: 14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 14 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                <DisassemblyView
                  pid={attachedPid}
                  addr={selectedEntry.addr}
                  functionName={selectedEntry.function}
                  module={selectedEntry.module}
                  onClose={() => setSelectedEntry(null)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <ProcessPicker
        picked={target}
        onPick={attach}
        onLaunch={() => setLaunchOpen(true)}
      />

      <LaunchDialog
        open={launchOpen}
        onClose={() => setLaunchOpen(false)}
        onLaunched={onLaunched}
      />
    </div>
  );
}

function StatsRow({ stats, running }: { stats: SamplerStats; running: boolean }) {
  const elapsedMs = useLiveElapsed(running, stats.elapsedMs);

  return (
    <div className="mt-4 grid grid-cols-5 gap-3">
      <AnimatedStat label="Samples"  value={stats.samplesTotal} />
      <AnimatedStat
        label="Threads"
        value={stats.threadsActive}
        secondary={stats.threadsSeen}
      />
      <AnimatedStat
        label="Dropped"
        value={stats.samplesDropped}
        accent={stats.samplesDropped > 0 ? "warn" : undefined}
      />
      <AnimatedStat
        label="Failures"
        value={stats.walkFailures}
        accent={stats.walkFailures > 0 ? "warn" : undefined}
      />
      <Stat label="Elapsed" value={formatMs(Math.round(elapsedMs))} />
    </div>
  );
}

function AnimatedStat({
  label,
  value,
  secondary,
  accent,
}: {
  label: string;
  value: number;
  secondary?: number;
  accent?: "warn";
}) {
  const animated  = useAnimatedNumber(value);
  const animatedB = useAnimatedNumber(secondary ?? 0);
  const display   = Math.round(animated).toLocaleString();
  const displayB  = secondary != null ? Math.round(animatedB).toLocaleString() : null;

  return (
    <div className="flex flex-col gap-0.5">
      <span className="label">{label}</span>
      <span
        className={
          "font-mono text-[15px] tabular-nums " +
          (accent === "warn" ? "text-amber-300" : "")
        }
      >
        {displayB == null ? display : `${display}/${displayB}`}
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="label">{label}</span>
      <span className="font-mono text-[15px] tabular-nums">{value}</span>
    </div>
  );
}

function ThreadDropdown({
  threads, selectedTid, onSelect, disabled,
}: {
  threads: { tid: number; samples: number; cpu100ns: number }[];
  selectedTid: number | null;
  onSelect: (tid: number | null) => void;
  disabled?: boolean;
}) {
  const cfg = useSettings();
  const options = [
    { value: "all", label: "All threads" },
    ...threads.map((t) => ({
      value: String(t.tid),
      label: cfg.threadAliases[String(t.tid)] || `TID ${t.tid}`,
      sub: formatCpuTime(t.cpu100ns) + " CPU",
    })),
  ];
  return (
    <div className="flex items-center gap-2">
      <span className="label">THREAD</span>
      <Select
        value={selectedTid == null ? "all" : String(selectedTid)}
        onChange={(v) => onSelect(v === "all" ? null : Number(v))}
        options={options}
        disabled={disabled}
      />
    </div>
  );
}

function formatCpuTime(cpu100ns: number): string {
  const ms = cpu100ns / 10_000;
  if (ms < 1)    return "0 ms";
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  const s = ms / 1000;
  if (s < 60)    return `${s.toFixed(2)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.floor(s % 60)}s`;
}

function HotFunctionsTable({
  profile, loading, capturing, hasTarget, selectedAddr, onSelect,
}: {
  profile: FlatProfile | null;
  loading: boolean;
  capturing: boolean;
  hasTarget: boolean;
  selectedAddr?: number | null;
  onSelect?: (e: FlatEntry) => void;
}) {
  const cfg = useSettings();
  const aliases = cfg.functionAliases;
  const [renaming, setRenaming] = useState<{ module: string; fn: string } | null>(null);
  const [renameVal, setRenameVal] = useState("");

  function startRename(module: string, fn: string) {
    setRenaming({ module, fn });
    setRenameVal(aliases[aliasKey(module, fn)] ?? fn);
  }
  function commitRename() {
    if (!renaming) return;
    saveAlias(aliases, renaming.module, renaming.fn, renameVal);
    setRenaming(null);
  }

  if (loading && !profile) {
    return (
      <div className="text-center text-[12px] text-white/30 font-mono pt-10">
        Aggregating capture…
      </div>
    );
  }
  if (!profile) {
    let hint: string;
    if (!hasTarget)        hint = "Attach a process to begin.";
    else if (capturing)    hint = "Sampling… first hits will appear shortly.";
    else                   hint = "Press Start to capture.";
    return (
      <div className="text-center text-[12px] text-white/30 font-mono pt-10">{hint}</div>
    );
  }
  if (profile.entries.length === 0) {
    return (
      <div className="text-center text-[12px] text-white/30 font-mono pt-10">
        {capturing ? "Sampling… first hits will appear shortly." : "No samples in this capture."}
      </div>
    );
  }

  const maxSelf = profile.entries.reduce((m, e) => Math.max(m, e.self), 0);
  const samplesTotal = profile.samplesTotal || 1;
  return (
    <div className="profile-table" style={{ borderRadius: 6 }}>
      <div className="profile-row profile-header">
        <div>Function</div>
        <div>Self %</div>
        <div className="justify-end">Total</div>
      </div>
      <AnimatePresence initial={false}>
        {profile.entries.slice(0, 50).map((e) => {
          const pct   = (e.self / samplesTotal) * 100;
          const width = maxSelf > 0 ? (e.self / maxSelf) * 100 : 0;
          const isSelected = selectedAddr != null && selectedAddr === e.addr;
          return (
            <motion.div
              key={`${e.module}::${e.function}::${e.addr}`}
              layout="position"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6, transition: { duration: 0.14 } }}
              transition={{
                opacity: { duration: 0.18 },
                y:       { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
                layout:  { type: "spring", stiffness: 420, damping: 38 },
              }}
              className={`profile-row ${isSelected ? "profile-row-highlight" : ""} ${onSelect ? "cursor-pointer" : ""}`}
              onClick={onSelect ? () => onSelect(e) : undefined}
              title={onSelect ? "Click to disassemble" : undefined}
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                {renaming?.module === e.module && renaming?.fn === e.function ? (
                  <input
                    autoFocus
                    className="profile-fn bg-transparent border border-white/25 rounded-sm px-0.5 outline-none selectable w-full"
                    value={renameVal}
                    onChange={(ev) => setRenameVal(ev.target.value)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter") commitRename();
                      if (ev.key === "Escape") setRenaming(null);
                    }}
                    onBlur={commitRename}
                  />
                ) : (
                  <span
                    className="profile-fn selectable"
                    onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); startRename(e.module, e.function); }}
                  >
                    {resolveAlias(aliases, e.module, e.function) || "<unresolved>"}
                  </span>
                )}
                <span className="profile-module selectable">{e.module || "—"}</span>
              </div>
              <div>
                {e.self > 0 ? (
                  <div className="profile-bar">
                    <motion.div
                      className="profile-bar-fill"
                      animate={{ width: `${width}%` }}
                      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                    />
                    <div className="profile-bar-label">{pct.toFixed(2)}%</div>
                  </div>
                ) : (
                  <span className="font-mono text-[10px] text-white/25">·</span>
                )}
              </div>
              <div className="justify-end font-mono text-[11px] text-white/55 tabular-nums">
                {e.total.toLocaleString()}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function defaultStats(pid: number, freq: number): SamplerStats {
  return {
    pid, frequencyHz: freq,
    samplesTotal: 0, samplesDropped: 0,
    threadsActive: 0, threadsSeen: 0, walkFailures: 0,
    elapsedMs: 0, running: false,
  };
}

function formatMs(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}m ${rem.toString().padStart(2, "0")}s`;
}
