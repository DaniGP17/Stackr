"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Search, RefreshCw, ArrowDownToLine, GitBranch, ZoomOut, ZoomIn,
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

const FRAME_HEIGHT = 20;
const MIN_BOX_WIDTH = 0.5;
const LABEL_MIN_WIDTH = 50;

type Box = {
  node:  CallTreeNode;
  x:     number;
  y:     number;
  w:     number;
  h:     number;
  depth: number;
};

export default function FlamegraphView({ pid }: { pid: number | null }) {
  const [tree, setTree]               = useState<CallTree | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error,   setError]           = useState<string | null>(null);
  const [mode,    setMode]            = useState<CallTreeMode>("topdown");
  const [selectedTid, setSelectedTid] = useState<number | null>(null);
  const [query,    setQuery]           = useState("");
  const [useRegex, setUseRegex]       = useState(false);
  const [zoomStack, setZoomStack]     = useState<CallTreeNode[]>([]);
  const [hover, setHover]             = useState<Box | null>(null);
  const [mousePos, setMousePos]       = useState({ x: 0, y: 0 });
  const [containerWidth, setContainerWidth] = useState(0);
  const [zoom, setZoom]               = useState(1);
  const [scrollLeft, setScrollLeft]   = useState(0);
  const cfg = useSettings();
  const aliases = cfg.functionAliases;
  const [renamePopover, setRenamePopover] = useState<{
    module: string; fn: string; screenX: number; screenY: number;
  } | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{
    x: number; y: number; node: { module: string; fn: string; addr: number };
  } | null>(null);

  // Incoming cross-view navigation
  useEffect(() => nav.on((view, target) => {
    if (view !== "flame") return;
    setQuery(target.fn);
  }), []);
  const autoSelectedRef = useRef(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);

  const zoomRef        = useRef(1);
  const scrollLeftRef  = useRef(0);
  const pendingScrollLeftRef = useRef<number | null>(null);
  const searchRef      = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
      setZoomStack([]);
      if (!autoSelectedRef.current && selectedTid == null && t.threads.length > 0) {
        autoSelectedRef.current = true;
        setSelectedTid(t.threads[0].tid);
      }
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
    setZoomStack([]);
    setQuery("");
    autoSelectedRef.current = false;
  }, [pid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (zoomStack.length > 0) {
        setZoomStack([]);
      } else if (zoomRef.current > 1) {
        resetZoom();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomStack.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        void load(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load]);

  const regex = useMemo(() => {
    if (!useRegex || !query.trim()) return null;
    try { return new RegExp(query.trim(), "i"); } catch { return null; }
  }, [useRegex, query]);
  const regexInvalid = useRegex && query.trim().length > 0 && regex === null;

  function queryMatches(text: string): boolean {
    const q = query.trim();
    if (!q) return false;
    if (regex) return regex.test(text);
    if (useRegex) return false;
    return text.toLowerCase().includes(q.toLowerCase());
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const oldZoom = zoomRef.current;
      const deltaY = e.deltaMode === 0 ? e.deltaY
                   : e.deltaMode === 1 ? e.deltaY * 16
                   : e.deltaY * 500;
      const factor  = Math.exp(-deltaY * 0.003);
      const newZoom = Math.max(1, Math.min(200, oldZoom * factor));
      if (Math.abs(newZoom - oldZoom) < 1e-4) return;
      zoomRef.current = newZoom;
      const baseScroll = pendingScrollLeftRef.current ?? scrollLeftRef.current;
      const newScroll  = (baseScroll + mouseX) * (newZoom / oldZoom) - mouseX;
      pendingScrollLeftRef.current = Math.max(0, newScroll);
      setZoom(newZoom);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  useLayoutEffect(() => {
    if (pendingScrollLeftRef.current == null || !containerRef.current) return;
    const container = containerRef.current;
    const max = Math.max(0, container.scrollWidth - container.clientWidth);
    const sl  = Math.min(Math.max(0, pendingScrollLeftRef.current), max);
    container.scrollLeft    = sl;
    scrollLeftRef.current   = sl;
    pendingScrollLeftRef.current = null;
  }, [zoom]);

  useEffect(() => {
    zoomRef.current      = 1;
    scrollLeftRef.current = 0;
    setZoom(1);
    setScrollLeft(0);
    if (containerRef.current) containerRef.current.scrollLeft = 0;
  }, [tree, zoomStack]);

  function resetZoom() {
    zoomRef.current       = 1;
    scrollLeftRef.current = 0;
    setZoom(1);
    setScrollLeft(0);
    if (containerRef.current) containerRef.current.scrollLeft = 0;
  }

  const zoomNode     = zoomStack[zoomStack.length - 1] ?? null;
  const surfaceWidth = containerWidth * zoom;

  const layout = useMemo(() => {
    if (!tree || surfaceWidth <= 0) return { boxes: [] as Box[], maxDepth: 0 };
    const boxes: Box[] = [];
    let maxDepth = 0;
    function place(node: CallTreeNode, depth: number, x: number, w: number) {
      if (depth > maxDepth) maxDepth = depth;
      boxes.push({ node, x, y: depth * FRAME_HEIGHT, w, h: FRAME_HEIGHT, depth });
      let childX = x;
      for (const c of node.children) {
        const cw = node.total > 0 ? (c.total / node.total) * w : 0;
        place(c, depth + 1, childX, cw);
        childX += cw;
      }
    }
    if (zoomNode) {
      place(zoomNode, 0, 0, surfaceWidth);
    } else {
      const rootTotal = tree.roots.reduce((s, r) => s + r.total, 0);
      let cursor = 0;
      for (const r of tree.roots) {
        const rw = rootTotal > 0 ? (r.total / rootTotal) * surfaceWidth : 0;
        place(r, 0, cursor, rw);
        cursor += rw;
      }
    }
    return { boxes, maxDepth };
  }, [tree, zoomNode, surfaceWidth]);

  const boxesByDepth = useMemo(() => {
    const m = new Map<number, Box[]>();
    for (const b of layout.boxes) {
      const arr = m.get(b.depth);
      if (arr) arr.push(b); else m.set(b.depth, [b]);
    }
    return m;
  }, [layout]);

  function hitTest(canvasX: number, y: number): Box | null {
    const wx    = canvasX + scrollLeftRef.current;
    const depth = Math.floor(y / FRAME_HEIGHT);
    const row   = boxesByDepth.get(depth);
    if (!row) return null;
    for (const box of row) {
      if (wx >= box.x && wx < box.x + box.w) return box;
    }
    return null;
  }

  const canvasHeight = (layout.maxDepth + 1) * FRAME_HEIGHT;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || containerWidth <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const cw  = containerWidth;
    const ch  = canvasHeight;
    canvas.style.width  = cw + "px";
    canvas.style.height = ch + "px";
    canvas.width  = Math.max(1, Math.floor(cw * dpr));
    canvas.height = Math.max(1, Math.floor(ch * dpr));

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = "11px ui-monospace, monospace";
    ctx.textBaseline = "middle";
    ctx.clearRect(0, 0, cw, ch);

    const sl       = scrollLeftRef.current;
    const visLeft  = sl;
    const visRight = sl + cw;

    ctx.save();
    ctx.translate(-sl, 0);

    for (const box of layout.boxes) {
      if (box.w < MIN_BOX_WIDTH) continue;
      if (box.x + box.w < visLeft || box.x > visRight) continue;

      const nodeMatches = queryMatches(box.node.function) || queryMatches(box.node.module);
      const matches = !!query.trim() && nodeMatches;
      const dim     = !!query.trim() && !nodeMatches;
      const fill = moduleFill(box.node.module, dim);

      ctx.fillStyle = fill;
      ctx.fillRect(box.x, box.y, box.w, box.h);

      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth   = 1;
      ctx.strokeRect(box.x + 0.5, box.y + 0.5, Math.max(0, box.w - 1), box.h - 1);

      if (matches) {
        ctx.strokeStyle = "#fde047";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(box.x + 0.75, box.y + 0.75, Math.max(0, box.w - 1.5), box.h - 1.5);
      }
      if (hover && hover.node === box.node) {
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(box.x + 0.75, box.y + 0.75, Math.max(0, box.w - 1.5), box.h - 1.5);
      }

      if (box.w >= LABEL_MIN_WIDTH) {
        ctx.fillStyle = dim ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.95)";
        ctx.save();
        ctx.beginPath();
        ctx.rect(box.x + 4, box.y, box.w - 8, box.h);
        ctx.clip();
        ctx.fillText(resolveAlias(aliases, box.node.module, box.node.function), box.x + 4, box.y + box.h / 2);
        ctx.restore();
      }
    }
    ctx.restore();
  }, [layout, hover, query, useRegex, regex, containerWidth, scrollLeft, canvasHeight, aliases]);

  function onCanvasMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover(hitTest(e.clientX - rect.left, e.clientY - rect.top));
  }
  function onCanvasLeave() { setHover(null); }
  function onCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const hit  = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) setZoomStack([...zoomStack, hit.node]);
  }
  function onContainerMove(e: React.MouseEvent<HTMLDivElement>) {
    setMousePos({ x: e.clientX, y: e.clientY });
  }
  function onContainerScroll(e: React.UIEvent<HTMLDivElement>) {
    const sl          = e.currentTarget.scrollLeft;
    scrollLeftRef.current = sl;
    setScrollLeft(sl);
  }
  function onCanvasContextMenu(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const hit  = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return;
    setCtxMenu({ x: e.clientX, y: e.clientY, node: { module: hit.node.module, fn: hit.node.function, addr: hit.node.addr } });
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  return (
    <div className="h-full p-4 flex flex-col gap-4 min-h-0">
      <div className="card p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="label">FLAMEGRAPH</p>
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
            "flex items-center gap-1.5 px-2 py-1.5 rounded border bg-black/40 w-56",
            regexInvalid ? "border-red-400/40" : "border-[var(--border)]",
          )}>
            <Search size={13} className="text-white/30 shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Highlight functions / modules"
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
            onClick={resetZoom}
            disabled={zoom === 1}
            title="Ctrl+wheel to zoom · click to reset"
            className={cn(
              "btn !py-1 !px-2 !text-[11px] font-mono tabular-nums",
              zoom === 1 && "opacity-40 cursor-default",
            )}
          >
            <ZoomIn size={11} />
            {zoom.toFixed(zoom < 10 ? 2 : zoom < 100 ? 1 : 0)}×
          </button>
          <button className="btn !py-1 !px-2 !text-[11px]" onClick={() => load(true)}
                  disabled={loading || pid == null} title="Rebuild from latest capture">
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            Rebuild
          </button>
        </div>
      </div>

      {zoomStack.length > 0 && (
        <div className="card px-3 py-2 flex items-center gap-1 text-[11px] font-mono">
          <button onClick={() => setZoomStack([])} className="text-white/55 hover:text-white">
            All
          </button>
          {zoomStack.map((n, i) => (
            <span key={`${n.id}-${i}`} className="contents">
              <span className="text-white/25 mx-0.5">›</span>
              <button
                onClick={() => setZoomStack(zoomStack.slice(0, i + 1))}
                className={cn(
                  i === zoomStack.length - 1 ? "text-white" : "text-white/55 hover:text-white",
                  "truncate max-w-[260px]",
                )}
                title={`${n.function}${n.module ? ` · ${n.module}` : ""}`}
              >
                {resolveAlias(aliases, n.module, n.function)}
              </button>
            </span>
          ))}
          <button
            onClick={() => setZoomStack([])}
            className="ml-auto text-white/40 hover:text-white inline-flex items-center gap-1"
            title="Reset zoom (Esc)"
          >
            <ZoomOut size={12} />
            <span className="text-[10px]">Esc</span>
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className="card flex-1 min-h-0 overflow-auto relative"
        onMouseMove={onContainerMove}
        onScroll={onContainerScroll}
      >
        {error && <div className="px-4 py-6 text-[12px] text-red-300/80 font-mono">{error}</div>}
        {!error && !tree && (
          <div className="px-4 py-10 text-center text-[12px] text-white/30 font-mono">
            {loading ? "Building tree…" : pid == null ? "No active capture." : "Press Rebuild to compute."}
          </div>
        )}
        {tree && tree.roots.length === 0 && (
          <div className="px-4 py-10 text-center text-[12px] text-white/30 font-mono">
            No samples in this capture.
          </div>
        )}
        {tree && tree.roots.length > 0 && (
          <div style={{ width: surfaceWidth, height: canvasHeight, position: "relative" }}>
            <canvas
              ref={canvasRef}
              onMouseMove={onCanvasMove}
              onMouseLeave={onCanvasLeave}
              onClick={onCanvasClick}
              onContextMenu={onCanvasContextMenu}
              className="block"
              style={{ position: "sticky", left: 0, top: 0, cursor: hover ? "pointer" : "default" }}
            />
          </div>
        )}
      </div>

      {hover && (
        <Tooltip
          box={hover}
          clientX={mousePos.x}
          clientY={mousePos.y}
          aliases={aliases}
        />
      )}

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: "Rename…", onClick: () => {
              setRenameVal(aliases[aliasKey(ctxMenu.node.module, ctxMenu.node.fn)] ?? ctxMenu.node.fn);
              setRenamePopover({ module: ctxMenu.node.module, fn: ctxMenu.node.fn, screenX: ctxMenu.x, screenY: ctxMenu.y });
            }},
            { separator: true },
            { label: "Copy function name", onClick: () => copy(resolveAlias(aliases, ctxMenu.node.module, ctxMenu.node.fn) || ctxMenu.node.fn) },
            { label: "Copy module",        onClick: () => copy(ctxMenu.node.module) },
            { separator: true },
            { label: "-> Flat Profile", onClick: () => nav.navigate("flat",   { module: ctxMenu.node.module, fn: ctxMenu.node.fn, addr: ctxMenu.node.addr }) },
            { label: "-> Call Tree",    onClick: () => nav.navigate("tree",   { module: ctxMenu.node.module, fn: ctxMenu.node.fn, addr: ctxMenu.node.addr }) },
            { label: "-> Source",       onClick: () => nav.navigate("source", { module: ctxMenu.node.module, fn: ctxMenu.node.fn, addr: ctxMenu.node.addr }) },
          ] satisfies ContextMenuItem[]}
        />
      )}

      {renamePopover && (
        <div
          className="fixed z-50 bg-[var(--bg-elev)] border border-[var(--border)] rounded p-3 shadow-lg flex flex-col gap-2 min-w-[240px]"
          style={{ left: renamePopover.screenX + 8, top: renamePopover.screenY + 8 }}
        >
          <p className="label">RENAME</p>
          <input
            autoFocus
            className="bg-black/40 border border-[var(--border)] rounded px-2 py-1 text-[11px] font-mono outline-none selectable"
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                saveAlias(aliases, renamePopover.module, renamePopover.fn, renameVal);
                setRenamePopover(null);
              }
              if (e.key === "Escape") setRenamePopover(null);
            }}
            onBlur={() => {
              saveAlias(aliases, renamePopover.module, renamePopover.fn, renameVal);
              setRenamePopover(null);
            }}
          />
          <p className="text-[10px] text-white/30 font-mono">Enter · clear to remove alias</p>
        </div>
      )}
    </div>
  );
}

function Tooltip({
  box, clientX, clientY, aliases,
}: {
  box: Box; clientX: number; clientY: number; aliases: Record<string, string>;
}) {
  const TOOLTIP_W = 320;
  const offset    = 14;
  const left = Math.min((typeof window !== "undefined" ? window.innerWidth : 1920) - TOOLTIP_W - 8, clientX + offset);
  const top  = Math.max(4, clientY + offset);
  return (
    <div
      className="fixed pointer-events-none bg-black/90 border border-white/15 rounded px-2.5 py-2 text-[11px] font-mono backdrop-blur-sm z-10 shadow-lg"
      style={{ left, top, width: TOOLTIP_W }}
    >
      <div className="text-white/95 break-all">{resolveAlias(aliases, box.node.module, box.node.function)}</div>
      <div className="text-white/40 mt-0.5 break-all">{box.node.module || "—"}</div>
      <div className="mt-2 grid grid-cols-[60px_1fr] gap-x-3 gap-y-0.5 tabular-nums">
        <span className="text-white/50">Total</span>
        <span className="text-white/85 text-right">
          {box.node.total.toLocaleString()} · {box.node.totalPct.toFixed(2)}%
        </span>
        <span className="text-white/50">Self</span>
        <span className="text-white/85 text-right">
          {box.node.self.toLocaleString()} · {box.node.selfPct.toFixed(2)}%
        </span>
        <span className="text-white/50">Depth</span>
        <span className="text-white/85 text-right">{box.depth}</span>
        <span className="text-white/50">Addr</span>
        <span className="text-white/85 text-right">0x{box.node.addr.toString(16).toUpperCase()}</span>
      </div>
      <div className="mt-2 pt-1.5 border-t border-white/10 text-[10px] text-white/35">
        Click to zoom in · Esc to reset
      </div>
    </div>
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

function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

function moduleFill(mod: string, dim: boolean): string {
  if (!mod) {
    return dim ? "rgba(120,120,120,0.25)" : "rgb(120,120,120)";
  }
  const hue = hashString(mod) % 360;
  const sat = 45 + (hashString(mod.slice(0, 3)) % 18);
  const lig = 36 + (hashString(mod.slice(-3))   % 8);
  return dim
    ? `hsla(${hue}, ${sat}%, ${lig}%, 0.25)`
    : `hsl(${hue}, ${sat}%, ${lig}%)`;
}
