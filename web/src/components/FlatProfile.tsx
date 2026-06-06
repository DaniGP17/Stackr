"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, RefreshCw, Download } from "lucide-react";
import { rpc, type FlatProfile } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { settings, useSettings, readSettings } from "@/lib/settings";
import { aliasKey, resolveAlias, saveAlias } from "@/lib/aliases";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { nav } from "@/lib/navigation";

type SortKey = "self" | "total" | "function" | "module";

export default function FlatProfileView({ pid }: { pid: number | null }) {
  const [profile, setProfile] = useState<FlatProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [query,   setQuery]   = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("self");
  const [topN,    setTopN]    = useState(() => readSettings().flatTopN);
  const cfg     = useSettings();
  const aliases = cfg.functionAliases;

  const [renaming, setRenaming] = useState<{ module: string; fn: string } | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [ctxMenu, setCtxMenu]   = useState<{
    x: number; y: number; module: string; fn: string; addr: number;
  } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => nav.on((view, target) => {
    if (view !== "flat") return;
    setQuery(target.fn);
  }), []);

  function startRename(module: string, fn: string) {
    setRenaming({ module, fn });
    setRenameVal(aliases[aliasKey(module, fn)] ?? fn);
  }
  function commitRename() {
    if (!renaming) return;
    saveAlias(aliases, renaming.module, renaming.fn, renameVal);
    setRenaming(null);
  }

  async function load(rebuild = false) {
    if (pid == null) return;
    setLoading(true); setError(null);
    try {
      const p = await rpc.call<FlatProfile>("analysis.flatProfile", { pid, topN, rebuild });
      setProfile(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (pid != null) void load();
  }, [pid]);

  useEffect(() => {
    if (pid == null) return;
    const off = rpc.on("sampler.stopped", (payload) => {
      const p = payload as { pid?: number };
      if (p?.pid === pid) void load(true);
    });
    return off;
  }, [pid]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "r" || e.key === "R") { e.preventDefault(); void load(true); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pid, topN]);

  const regex = useMemo(() => {
    if (!useRegex || !query.trim()) return null;
    try { return new RegExp(query.trim(), "i"); } catch { return null; }
  }, [useRegex, query]);
  const regexInvalid = useRegex && query.trim().length > 0 && regex === null;

  function matches(text: string): boolean {
    if (!query.trim()) return true;
    if (useRegex) return regex ? regex.test(text) : false;
    return text.toLowerCase().includes(query.trim().toLowerCase());
  }

  const filtered = useMemo(() => {
    if (!profile) return [];
    let out = profile.entries.filter((e) =>
      matches(e.function) ||
      matches(e.module) ||
      matches(resolveAlias(aliases, e.module, e.function)),
    );
    return [...out].sort((a, b) => {
      switch (sortKey) {
        case "self":     return b.self  - a.self;
        case "total":    return b.total - a.total;
        case "function": return resolveAlias(aliases, a.module, a.function)
                                .localeCompare(resolveAlias(aliases, b.module, b.function));
        case "module":   return a.module.localeCompare(b.module);
      }
    });
  }, [profile, query, useRegex, regex, sortKey, aliases]);

  const maxSelf      = useMemo(() => profile?.entries.reduce((m, e) => Math.max(m, e.self), 0) ?? 0, [profile]);
  const samplesTotal = profile?.samplesTotal ?? 0;

  function exportCSV() {
    if (!profile) return;
    const header = "Function,Module,Self %,Self Samples,Total Samples,Address";
    const rows = filtered.slice(0, topN).map((e) => [
      `"${resolveAlias(aliases, e.module, e.function).replace(/"/g, '""')}"`,
      `"${e.module.replace(/"/g, '""')}"`,
      samplesTotal > 0 ? ((e.self / samplesTotal) * 100).toFixed(2) : "0",
      e.self,
      e.total,
      `"0x${e.addr.toString(16).toUpperCase()}"`,
    ].join(","));
    const csv  = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `stackr-flat-${profile.pid}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  return (
    <div className="h-full p-4 flex flex-col gap-4">
      <div className="card p-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="label">FLAT PROFILE</p>
          {profile ? (
            <p className="font-mono text-[12px] text-white/55 mt-1">
              pid {profile.pid} · {profile.samplesTotal.toLocaleString()} samples ·{" "}
              {profile.entryCount.toLocaleString()} unique functions · {profile.elapsedMs} ms
              {profile.samplesUnresolved > 0 && (
                <> · <span className="text-amber-300/70">{profile.samplesUnresolved} unresolved</span></>
              )}
            </p>
          ) : (
            <p className="text-[12px] text-white/40 mt-1">No profile loaded — capture some samples first.</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Search with regex toggle */}
          <div className={cn(
            "flex items-center gap-1.5 px-2 py-1.5 rounded border bg-black/40 w-64",
            regexInvalid ? "border-red-400/40" : "border-[var(--border)]",
          )}>
            <Search size={13} className="text-white/30 shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by function or module"
              className="bg-transparent outline-none text-[12px] flex-1 selectable"
            />
            <button
              onClick={() => setUseRegex((v) => !v)}
              title="Toggle regex (.*)"
              className={cn(
                "font-mono text-[10px] px-1 rounded transition-colors shrink-0",
                useRegex ? "text-white bg-white/10" : "text-white/30 hover:text-white/60",
              )}
            >
              .*
            </button>
          </div>
          <button
            className="btn !py-1 !px-2 !text-[11px]"
            onClick={exportCSV}
            disabled={!profile}
            title="Export visible rows as CSV"
          >
            <Download size={11} />
            CSV
          </button>
          <button className="btn" onClick={() => load(true)} disabled={loading || pid == null} title="Rebuild (R)">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Rebuild
          </button>
        </div>
      </div>

      <div className="card flex-1 min-h-0 overflow-hidden flex flex-col">
        {error && <div className="px-4 py-6 text-[12px] text-red-300/80 font-mono">{error}</div>}
        {!error && !profile && (
          <div className="px-4 py-10 text-center text-[12px] text-white/30 font-mono">
            {loading ? "Loading…" : pid == null ? "No active capture." : "Empty profile."}
          </div>
        )}
        {profile && (
          <div className="flex-1 overflow-auto">
            <div className="profile-table sticky top-0 z-10">
              <div className="profile-row profile-header" style={{ gridTemplateColumns: "minmax(0, 1fr) 220px 110px" }}>
                <Header label="Function · Module" k="function" current={sortKey} onClick={setSortKey} />
                <Header label="Self %" k="self" current={sortKey} onClick={setSortKey} />
                <Header label="Total" k="total" current={sortKey} onClick={setSortKey} alignEnd />
              </div>
            </div>
            <div className="profile-table" style={{ border: "0", borderRadius: 0 }}>
              <AnimatePresence initial={false}>
                {filtered.slice(0, topN).map((e) => {
                  const pct   = samplesTotal > 0 ? (e.self / samplesTotal) * 100 : 0;
                  const width = maxSelf > 0 ? (e.self / maxSelf) * 100 : 0;
                  const displayName = resolveAlias(aliases, e.module, e.function) || "<unresolved>";
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
                      className="profile-row"
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
                            onContextMenu={(ev) => {
                              ev.preventDefault();
                              ev.stopPropagation();
                              setCtxMenu({ x: ev.clientX, y: ev.clientY, module: e.module, fn: e.function, addr: e.addr });
                            }}
                          >
                            {displayName}
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
            <div className="flex items-center justify-between px-4 py-2 text-[10px] text-white/30 font-mono border-t border-[var(--border)]">
              <span>
                showing {Math.min(filtered.length, topN).toLocaleString()} of {filtered.length.toLocaleString()} (filtered)
                · {profile.entryCount.toLocaleString()} total
              </span>
              <span>Ctrl+F to search · R to rebuild</span>
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
            { label: "Rename…", onClick: () => startRename(ctxMenu.module, ctxMenu.fn) },
            { separator: true },
            { label: "Copy function name", onClick: () => copy(resolveAlias(aliases, ctxMenu.module, ctxMenu.fn) || ctxMenu.fn) },
            { label: "Copy module",        onClick: () => copy(ctxMenu.module) },
            { label: "Copy address",       onClick: () => copy(`0x${ctxMenu.addr.toString(16).toUpperCase()}`) },
            { separator: true },
            { label: "-> Call Tree",    onClick: () => nav.navigate("tree",   { module: ctxMenu.module, fn: ctxMenu.fn, addr: ctxMenu.addr }) },
            { label: "-> Flame Graph",  onClick: () => nav.navigate("flame",  { module: ctxMenu.module, fn: ctxMenu.fn, addr: ctxMenu.addr }) },
            { label: "-> Source",       onClick: () => nav.navigate("source", { module: ctxMenu.module, fn: ctxMenu.fn, addr: ctxMenu.addr }) },
          ] satisfies ContextMenuItem[]}
        />
      )}
    </div>
  );
}

function Header({
  label, k, current, onClick, alignEnd,
}: {
  label: string;
  k: SortKey;
  current: SortKey;
  onClick: (k: SortKey) => void;
  alignEnd?: boolean;
}) {
  return (
    <div
      onClick={() => onClick(k)}
      className={cn(
        "cursor-pointer select-none flex items-center gap-1",
        alignEnd && "justify-end",
      )}
    >
      <span>{label}</span>
      {current === k && <span className="text-white/60">▼</span>}
    </div>
  );
}
