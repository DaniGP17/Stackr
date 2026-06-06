"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, ChevronRight, ChevronDown } from "lucide-react";
import { rpc, type FlatProfile, type FlatEntry } from "@/lib/bridge";
import { useSettings } from "@/lib/settings";
import { resolveAlias } from "@/lib/aliases";
import { Select } from "./Select";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { nav } from "@/lib/navigation";

type ModuleGroup = {
  module: string;
  selfSamples: number;
  totalSamples: number;
  functions: FlatEntry[];
};

function formatCpuTime(cpu100ns: number): string {
  const ms = cpu100ns / 10_000;
  if (ms < 1)    return "0 ms";
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  const s = ms / 1000;
  if (s < 60)    return `${s.toFixed(2)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.floor(s % 60)}s`;
}

export default function ModulesView({ pid }: { pid: number | null }) {
  const [profile, setProfile]       = useState<FlatProfile | null>(null);
  const [loading, setLoading]       = useState(false);
  const [selectedTid, setSelectedTid] = useState<number | null>(null);
  const [expanded, setExpanded]     = useState<Set<string>>(new Set());
  const cfg     = useSettings();
  const aliases = cfg.functionAliases;
  const [ctxMenu, setCtxMenu] = useState<{
    x: number; y: number; module: string; fn: string; addr: number;
  } | null>(null);

  function copy(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  const load = useCallback(async (rebuild: boolean) => {
    if (pid == null) { setProfile(null); return; }
    setLoading(true);
    try {
      const params: Record<string, unknown> = { pid, topN: 10000, rebuild };
      if (selectedTid != null) params.tid = selectedTid;
      const p = await rpc.call<FlatProfile>("analysis.flatProfile", params);
      setProfile(p);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [pid, selectedTid]);

  useEffect(() => { void load(false); }, [load]);

  useEffect(() => {
    if (pid == null) return;
    const off = rpc.on("sampler.stopped", (payload) => {
      const p = payload as { pid?: number };
      if (p?.pid === pid) void load(true);
    });
    return off;
  }, [pid, load]);

  useEffect(() => {
    setProfile(null);
    setSelectedTid(null);
    setExpanded(new Set());
  }, [pid]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "r" || e.key === "R") { e.preventDefault(); void load(true); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load]);

  const groups = useMemo((): ModuleGroup[] => {
    if (!profile) return [];
    const map = new Map<string, ModuleGroup>();
    for (const e of profile.entries) {
      const key = e.module || "<unknown>";
      if (!map.has(key)) map.set(key, { module: key, selfSamples: 0, totalSamples: 0, functions: [] });
      const g = map.get(key)!;
      g.selfSamples  += e.self;
      g.totalSamples += e.total;
      g.functions.push(e);
    }
    return [...map.values()].sort((a, b) => b.totalSamples - a.totalSamples);
  }, [profile]);

  const samplesTotal = profile?.samplesTotal ?? 1;
  const maxTotal     = groups[0]?.totalSamples ?? 1;

  function toggle(mod: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(mod)) next.delete(mod); else next.add(mod);
      return next;
    });
  }

  const cols = "minmax(0,1fr) 180px 90px 60px";

  return (
    <div className="h-full p-4 flex flex-col gap-4">
      <div className="card p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="label">MODULES</p>
          {profile ? (
            <p className="font-mono text-[12px] text-white/55 mt-1">
              pid {profile.pid} · {groups.length} modules · {profile.samplesTotal.toLocaleString()} samples · {profile.elapsedMs} ms
              {profile.samplesUnresolved > 0 && (
                <> · <span className="text-amber-300/70">{profile.samplesUnresolved.toLocaleString()} unresolved</span></>
              )}
            </p>
          ) : (
            <p className="text-[12px] text-white/40 mt-1">
              {pid == null ? "Attach a process to see module breakdown." : "No data yet."}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {profile && profile.threads.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="label">THREAD</span>
              <Select
                value={selectedTid == null ? "all" : String(selectedTid)}
                onChange={(v) => setSelectedTid(v === "all" ? null : Number(v))}
                options={[
                  { value: "all", label: "All threads" },
                  ...profile.threads.map((t) => ({
                    value: String(t.tid),
                    label: cfg.threadAliases[String(t.tid)] || `TID ${t.tid}`,
                    sub: formatCpuTime(t.cpu100ns) + " CPU",
                  })),
                ]}
                disabled={loading}
              />
            </div>
          )}
          <button
            className="btn shrink-0"
            onClick={() => void load(true)}
            disabled={loading || pid == null}
            title="Rebuild (R)"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Rebuild
          </button>
        </div>
      </div>

      <div className="card flex-1 min-h-0 overflow-hidden flex flex-col">
        {pid == null && (
          <div className="px-4 py-10 text-center text-[12px] text-white/30 font-mono">
            Attach a process to see module breakdown.
          </div>
        )}
        {pid != null && groups.length === 0 && !loading && (
          <div className="px-4 py-10 text-center text-[12px] text-white/30 font-mono">
            {loading ? "Loading…" : "No data — capture samples and press Rebuild."}
          </div>
        )}
        {groups.length > 0 && (
          <div className="flex-1 overflow-auto">
            <div className="profile-table" style={{ border: 0, borderRadius: 0 }}>
              <div className="profile-row profile-header sticky top-0 z-10" style={{ gridTemplateColumns: cols }}>
                <div>Module</div>
                <div>Total samples</div>
                <div>Self %</div>
                <div className="justify-end">Fns</div>
              </div>

              {groups.map((g) => {
                const isOpen    = expanded.has(g.module);
                const totalPct  = (g.totalSamples / samplesTotal) * 100;
                const selfPct   = (g.selfSamples  / samplesTotal) * 100;
                const barWidth  = (g.totalSamples / maxTotal) * 100;
                const sortedFns = [...g.functions].sort((a, b) => b.total - a.total);

                return (
                  <Fragment key={g.module}>
                    <div
                      className="profile-row cursor-pointer"
                      style={{ gridTemplateColumns: cols }}
                      onClick={() => toggle(g.module)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-white/35 shrink-0">
                          {isOpen
                            ? <ChevronDown size={11} />
                            : <ChevronRight size={11} />}
                        </span>
                        <span className="profile-fn font-medium text-white/85">
                          {g.module || "<unknown>"}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="profile-bar flex-1">
                            <div className="profile-bar-fill" style={{ width: `${barWidth}%` }} />
                            <div className="profile-bar-label">{totalPct.toFixed(1)}%</div>
                          </div>
                          <span className="font-mono text-[10px] text-white/35 tabular-nums shrink-0">
                            {g.totalSamples.toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <div className="font-mono text-[11px] text-white/50 tabular-nums">
                        {selfPct.toFixed(1)}%
                      </div>
                      <div className="justify-end font-mono text-[11px] text-white/35 tabular-nums">
                        {g.functions.length}
                      </div>
                    </div>

                    {isOpen && sortedFns.slice(0, 30).map((e) => {
                      const eName   = resolveAlias(aliases, e.module, e.function) || "<unresolved>";
                      const ePct    = (e.total / samplesTotal) * 100;
                      const eSelfPct = (e.self  / samplesTotal) * 100;
                      return (
                        <div
                          key={`${e.module}::${e.function}::${e.addr}`}
                          className="profile-row"
                          style={{ gridTemplateColumns: cols, background: "rgba(255,255,255,0.012)" }}
                        >
                          <div className="flex flex-col gap-0.5 min-w-0 pl-9">
                            <span
                              className="profile-fn text-white/65 selectable"
                              onContextMenu={(ev) => {
                                ev.preventDefault(); ev.stopPropagation();
                                setCtxMenu({ x: ev.clientX, y: ev.clientY, module: e.module, fn: e.function, addr: e.addr });
                              }}
                            >{eName}</span>
                          </div>
                          <div className="font-mono text-[11px] text-white/50 tabular-nums">
                            {ePct.toFixed(1)}%
                            <span className="text-white/25 ml-1.5">{e.total.toLocaleString()}</span>
                          </div>
                          <div className="font-mono text-[11px] text-white/35 tabular-nums">
                            {eSelfPct.toFixed(1)}%
                          </div>
                          <div className="justify-end font-mono text-[10px] text-white/20 tabular-nums">
                            —
                          </div>
                        </div>
                      );
                    })}

                    {isOpen && g.functions.length > 30 && (
                      <div
                        className="profile-row"
                        style={{ gridTemplateColumns: cols, background: "rgba(255,255,255,0.012)" }}
                      >
                        <div className="pl-9 font-mono text-[10px] text-white/25 col-span-4">
                          +{g.functions.length - 30} more functions
                        </div>
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: "Copy function name", onClick: () => copy(resolveAlias(aliases, ctxMenu.module, ctxMenu.fn) || ctxMenu.fn) },
            { label: "Copy module",        onClick: () => copy(ctxMenu.module) },
            { separator: true },
            { label: "-> Flat Profile", onClick: () => nav.navigate("flat",   { module: ctxMenu.module, fn: ctxMenu.fn, addr: ctxMenu.addr }) },
            { label: "-> Call Tree",    onClick: () => nav.navigate("tree",   { module: ctxMenu.module, fn: ctxMenu.fn, addr: ctxMenu.addr }) },
            { label: "-> Flame Graph",  onClick: () => nav.navigate("flame",  { module: ctxMenu.module, fn: ctxMenu.fn, addr: ctxMenu.addr }) },
            { label: "-> Source",       onClick: () => nav.navigate("source", { module: ctxMenu.module, fn: ctxMenu.fn, addr: ctxMenu.addr }) },
          ] satisfies ContextMenuItem[]}
        />
      )}
    </div>
  );
}
