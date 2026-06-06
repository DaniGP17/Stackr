"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Search, RefreshCw, ChevronRight, ChevronDown,
  ArrowDownToLine, ArrowUpToLine, GitBranch,
} from "lucide-react";
import {
  rpc,
  type CallTree, type CallTreeNode, type CallTreeMode,
} from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { settings, useSettings, readSettings } from "@/lib/settings";
import { aliasKey, resolveAlias, saveAlias } from "@/lib/aliases";
import { Select } from "./Select";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { nav } from "@/lib/navigation";

export default function CallTreeView({ pid }: { pid: number | null }) {
  const [tree, setTree]       = useState<CallTree | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [mode,    setMode]    = useState<CallTreeMode>("topdown");
  const [selectedTid, setSelectedTid] = useState<number | null>(null);
  const [query,    setQuery]    = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const cfg = useSettings();
  const aliases = cfg.functionAliases;
  const [renaming, setRenaming] = useState<{ module: string; fn: string } | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{
    x: number; y: number; module: string; fn: string; addr: number;
  } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => nav.on((view, target) => {
    if (view !== "tree") return;
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

  const autoSelectedRef = useRef(false);

  const load = useCallback(async (rebuild: boolean) => {
    if (pid == null) { setTree(null); return; }
    setLoading(true); setError(null);
    try {
      const cfg = readSettings();
      const params: Record<string, unknown> = {
        pid, mode, rebuild,
        maxDepth: cfg.callTreeMaxDepth,
        minSamples: cfg.callTreeMinSamples,
      };
      if (selectedTid != null) params.tid = selectedTid;
      const t = await rpc.call<CallTree>("analysis.callTree", params);
      setTree(t);

      if (!autoSelectedRef.current && selectedTid == null && t.threads.length > 0) {
        autoSelectedRef.current = true;
        setSelectedTid(t.threads[0].tid);
        return;
      }

      const opened = new Set<number>();
      if (t.roots.length > 0) {
        let cur: CallTreeNode | undefined = t.roots[0];
        for (let i = 0; i < 4 && cur; ++i) {
          opened.add(cur.id);
          cur = cur.children[0];
        }
      }
      setExpanded(opened);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [pid, mode, selectedTid]);

  useEffect(() => { void load(false); }, [load]);

  useEffect(() => {
    if (pid == null) return;
    const off = rpc.on("sampler.stopped", (payload) => {
      const p = payload as { pid?: number };
      if (p?.pid === pid) {
        autoSelectedRef.current = false;
        setSelectedTid(null);
        void load(true);
      }
    });
    return off;
  }, [pid, load]);

  useEffect(() => {
    setSelectedTid(null);
    setExpanded(new Set());
    setQuery("");
    autoSelectedRef.current = false;
  }, [pid]);

  // Keyboard shortcuts
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
  }, [load]);

  const regex = useMemo(() => {
    if (!useRegex || !query.trim()) return null;
    try { return new RegExp(query.trim(), "i"); } catch { return null; }
  }, [useRegex, query]);
  const regexInvalid = useRegex && query.trim().length > 0 && regex === null;

  function nodeMatches(n: CallTreeNode): boolean {
    const q = query.trim();
    if (!q) return true;
    const texts = [n.function, n.module, resolveAlias(aliases, n.module, n.function)];
    if (regex) return texts.some((t) => regex.test(t));
    const ql = q.toLowerCase();
    return texts.some((t) => t.toLowerCase().includes(ql));
  }

  const { visibleIds, autoExpand } = useMemo(() => {
    if (!query.trim() || !tree) return { visibleIds: null as Set<number> | null, autoExpand: null as Set<number> | null };
    const visible  = new Set<number>();
    const expandOn = new Set<number>();
    const walk = (n: CallTreeNode): boolean => {
      const selfMatch = nodeMatches(n);
      let childMatch = false;
      for (const c of n.children) if (walk(c)) childMatch = true;
      if (selfMatch || childMatch) {
        visible.add(n.id);
        if (childMatch) expandOn.add(n.id);
        return true;
      }
      return false;
    };
    for (const r of tree.roots) walk(r);
    return { visibleIds: visible, autoExpand: expandOn };
  }, [query, useRegex, regex, tree, aliases]);

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function expandAll() {
    if (!tree) return;
    const all = new Set<number>();
    const walk = (n: CallTreeNode) => {
      if (n.children.length > 0) all.add(n.id);
      for (const c of n.children) walk(c);
    };
    for (const r of tree.roots) walk(r);
    setExpanded(all);
  }

  function collapseAll() {
    setExpanded(new Set());
  }

  function handleNodeContextMenu(e: { clientX: number; clientY: number }, node: CallTreeNode) {
    setCtxMenu({ x: e.clientX, y: e.clientY, module: node.module, fn: node.function, addr: node.addr });
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  return (
    <div className="h-full p-4 flex flex-col gap-4 min-h-0">
      <div className="card p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="label">CALL TREE</p>
          {tree ? (
            <p className="font-mono text-[12px] text-white/55 mt-1 truncate">
              pid {tree.pid} · {tree.samplesTotal.toLocaleString()} samples · {tree.nodeCount.toLocaleString()} nodes · {tree.elapsedMs} ms
              {tree.samplesUnresolved > 0 && (
                <> · <span className="text-amber-300/70">{tree.samplesUnresolved.toLocaleString()} unresolved</span></>
              )}
            </p>
          ) : (
            <p className="text-[12px] text-white/40 mt-1">
              {pid == null ? "Attach a process and capture samples first." : "No data yet."}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <ModeToggle mode={mode} onChange={setMode} />
          {tree && tree.threads.length > 0 && (
            <ThreadDropdown
              threads={tree.threads}
              selectedTid={selectedTid}
              onSelect={setSelectedTid}
              disabled={loading}
            />
          )}
          <div className={cn(
            "flex items-center gap-1.5 px-2 py-1.5 rounded border bg-black/40 w-64",
            regexInvalid ? "border-red-400/40" : "border-[var(--border)]",
          )}>
            <Search size={13} className="text-white/30 shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter functions / modules"
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
          <button className="btn !py-1 !px-2 !text-[11px]" onClick={expandAll}
                  disabled={loading || !tree} title="Expand every node">
            <ArrowDownToLine size={11} /> Expand
          </button>
          <button className="btn !py-1 !px-2 !text-[11px]" onClick={collapseAll}
                  disabled={loading || !tree} title="Collapse every node">
            <ArrowUpToLine size={11} /> Collapse
          </button>
          <button className="btn !py-1 !px-2 !text-[11px]" onClick={() => load(true)}
                  disabled={loading || pid == null} title="Rebuild from latest capture">
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            Rebuild
          </button>
        </div>
      </div>

      <div className="card flex-1 min-h-0 overflow-hidden flex flex-col">
        {error && <div className="px-4 py-6 text-[12px] text-red-300/80 font-mono">{error}</div>}
        {!error && !tree && (
          <div className="px-4 py-10 text-center text-[12px] text-white/30 font-mono">
            {loading ? "Building tree…" : pid == null ? "No active capture." : "Press Rebuild to compute."}
          </div>
        )}
        {!error && tree && tree.roots.length === 0 && (
          <div className="px-4 py-10 text-center text-[12px] text-white/30 font-mono">
            No samples in this capture.
          </div>
        )}
        {tree && tree.roots.length > 0 && (
          <div className="flex-1 min-h-0 overflow-auto">
            <div className="profile-table" style={{ border: 0, borderRadius: 0 }}>
              <div
                className="profile-row profile-header"
                style={{ gridTemplateColumns: "minmax(0, 1fr) 130px 110px 80px" }}
              >
                <div>Function · Module</div>
                <div>Total %</div>
                <div className="justify-end">Total</div>
                <div className="justify-end">Self</div>
              </div>
              {tree.roots.map((root) => (
                <TreeRows
                  key={root.id}
                  node={root}
                  depth={0}
                  expanded={expanded}
                  autoExpand={autoExpand}
                  visibleIds={visibleIds}
                  onToggle={toggle}
                  aliases={aliases}
                  renaming={renaming}
                  renameVal={renameVal}
                  onStartRename={startRename}
                  onRenameChange={setRenameVal}
                  onCommitRename={commitRename}
                  onCancelRename={() => setRenaming(null)}
                  onContextMenu={handleNodeContextMenu}
                />
              ))}
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
            { label: "Rename…", onClick: () => { startRename(ctxMenu.module, ctxMenu.fn); setCtxMenu(null); } },
            { separator: true },
            { label: "Copy function name", onClick: () => copy(resolveAlias(aliases, ctxMenu.module, ctxMenu.fn) || ctxMenu.fn) },
            { label: "Copy module",        onClick: () => copy(ctxMenu.module) },
            { separator: true },
            { label: "-> Flat Profile", onClick: () => nav.navigate("flat",   { module: ctxMenu.module, fn: ctxMenu.fn, addr: ctxMenu.addr }) },
            { label: "-> Flame Graph",  onClick: () => nav.navigate("flame",  { module: ctxMenu.module, fn: ctxMenu.fn, addr: ctxMenu.addr }) },
            { label: "-> Source",       onClick: () => nav.navigate("source", { module: ctxMenu.module, fn: ctxMenu.fn, addr: ctxMenu.addr }) },
          ] satisfies ContextMenuItem[]}
        />
      )}
    </div>
  );
}

function TreeRows({
  node, depth, expanded, autoExpand, visibleIds, onToggle,
  aliases, renaming, renameVal, onStartRename, onRenameChange, onCommitRename, onCancelRename,
  onContextMenu,
}: {
  node: CallTreeNode;
  depth: number;
  expanded: Set<number>;
  autoExpand: Set<number> | null;
  visibleIds: Set<number> | null;
  onToggle: (id: number) => void;
  aliases: Record<string, string>;
  renaming: { module: string; fn: string } | null;
  renameVal: string;
  onStartRename: (module: string, fn: string) => void;
  onRenameChange: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onContextMenu: (e: { clientX: number; clientY: number }, node: CallTreeNode) => void;
}) {
  if (visibleIds && !visibleIds.has(node.id)) return null;

  const hasChildren = node.children.length > 0;
  const userExpanded = expanded.has(node.id);
  const forcedExpand = autoExpand?.has(node.id) ?? false;
  const isExpanded = hasChildren && (userExpanded || forcedExpand);

  return (
    <>
      <div
        className={cn(
          "profile-row",
          hasChildren && "cursor-pointer",
        )}
        style={{ gridTemplateColumns: "minmax(0, 1fr) 130px 110px 80px" }}
        onClick={hasChildren ? () => onToggle(node.id) : undefined}
        title={hasChildren ? "Click to expand/collapse" : undefined}
      >
        <div className="flex items-center min-w-0" style={{ paddingLeft: `${depth * 16 + 4}px` }}>
          <span className="w-4 h-4 inline-flex items-center justify-center text-white/45 shrink-0">
            {hasChildren
              ? (isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />)
              : null}
          </span>
          <div className="flex flex-col gap-0.5 min-w-0 ml-1">
            {renaming?.module === node.module && renaming?.fn === node.function ? (
              <input
                autoFocus
                className="profile-fn bg-transparent border border-white/25 rounded-sm px-0.5 outline-none selectable w-full"
                value={renameVal}
                onChange={(ev) => onRenameChange(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") onCommitRename();
                  if (ev.key === "Escape") onCancelRename();
                }}
                onBlur={onCommitRename}
              />
            ) : (
              <span
                className="profile-fn selectable"
                onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); onContextMenu(ev, node); }}
              >
                {resolveAlias(aliases, node.module, node.function) || "<unnamed>"}
              </span>
            )}
            <span className="profile-module selectable">{node.module || "—"}</span>
          </div>
        </div>
        <div>
          <div className="profile-bar">
            <div className="profile-bar-fill" style={{ width: `${Math.min(100, node.totalPct)}%` }} />
            <div className="profile-bar-label">{node.totalPct.toFixed(2)}%</div>
          </div>
        </div>
        <div className="justify-end font-mono text-[11px] text-white/55 tabular-nums">
          {node.total.toLocaleString()}
        </div>
        <div className="justify-end font-mono text-[11px] tabular-nums">
          {node.self > 0 ? (
            <span className="text-rose-300/80" title={`${node.selfPct.toFixed(2)}% self`}>
              {node.self.toLocaleString()}
            </span>
          ) : (
            <span className="text-white/25">·</span>
          )}
        </div>
      </div>
      {isExpanded && node.children.map((c) => (
        <TreeRows
          key={c.id}
          node={c}
          depth={depth + 1}
          expanded={expanded}
          autoExpand={autoExpand}
          visibleIds={visibleIds}
          onToggle={onToggle}
          aliases={aliases}
          renaming={renaming}
          renameVal={renameVal}
          onStartRename={onStartRename}
          onRenameChange={onRenameChange}
          onCommitRename={onCommitRename}
          onCancelRename={onCancelRename}
          onContextMenu={onContextMenu}
        />
      ))}
    </>
  );
}

function ModeToggle({
  mode, onChange,
}: {
  mode: CallTreeMode;
  onChange: (m: CallTreeMode) => void;
}) {
  return (
    <div
      className="flex items-center rounded border border-[var(--border)] bg-black/40 overflow-hidden text-[11px]"
      title="Top-down: thread entry points -> callees. Bottom-up: hot leaves -> callers."
    >
      <button
        className={cn(
          "px-2 py-1 flex items-center gap-1",
          mode === "topdown" ? "bg-white/10 text-white" : "text-white/55 hover:text-white",
        )}
        onClick={() => onChange("topdown")}
      >
        <ArrowDownToLine size={11} />
        Top-down
      </button>
      <button
        className={cn(
          "px-2 py-1 flex items-center gap-1 border-l border-[var(--border)]",
          mode === "bottomup" ? "bg-white/10 text-white" : "text-white/55 hover:text-white",
        )}
        onClick={() => onChange("bottomup")}
      >
        <GitBranch size={11} />
        Bottom-up
      </button>
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
