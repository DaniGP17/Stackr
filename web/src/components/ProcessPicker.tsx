"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, RefreshCw, Rocket, Lock, Cpu } from "lucide-react";
import { rpc, type ProcessInfo } from "@/lib/bridge";
import { cn } from "@/lib/cn";

type SortKey = "name" | "pid" | "threads";

export default function ProcessPicker({
  onPick,
  onLaunch,
  picked,
}: {
  onPick: (p: ProcessInfo) => void;
  onLaunch: () => void;
  picked?: ProcessInfo | null;
}) {
  const [items, setItems] = useState<ProcessInfo[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyX64, setOnlyX64] = useState(true);
  const [onlyAccessible, setOnlyAccessible] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("threads");

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const list = await rpc.call<ProcessInfo[]>("process.list", { withPaths: true });
      setItems(list ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = items.filter((p) => p.pid !== 0);
    if (onlyX64) out = out.filter((p) => p.bitness === "x64");
    if (onlyAccessible) out = out.filter((p) => p.accessible);
    if (q) {
      out = out.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          String(p.pid).includes(q) ||
          p.path?.toLowerCase().includes(q),
      );
    }
    out.sort((a, b) => {
      switch (sortKey) {
        case "pid":     return a.pid - b.pid;
        case "name":    return a.name.localeCompare(b.name);
        case "threads": return b.threads - a.threads;
      }
    });
    return out;
  }, [items, query, onlyX64, onlyAccessible, sortKey]);

  return (
    <div className="card flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <div>
          <p className="label">TARGET</p>
          <h3 className="heading-sm mt-0.5">Pick a process</h3>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn" onClick={onLaunch}>
            <Rocket size={13} />
            Launch
          </button>
          <button className="btn" onClick={refresh} disabled={loading}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-[var(--border)] flex flex-col gap-2">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded border border-[var(--border)] bg-black/40">
          <Search size={13} className="text-white/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, PID or path"
            className="bg-transparent outline-none text-[13px] flex-1 selectable"
          />
          <span className="font-mono text-[10px] text-white/30">
            {filtered.length}/{items.length}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-white/55">
          <Toggle checked={onlyX64} onChange={setOnlyX64} label="x64 only" />
          <Toggle checked={onlyAccessible} onChange={setOnlyAccessible} label="accessible" />
          <span className="ml-auto flex items-center gap-1.5">
            sort
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="bg-black/40 border border-[var(--border)] rounded px-1.5 py-0.5 font-mono text-[10px] outline-none"
            >
              <option value="threads">threads</option>
              <option value="name">name</option>
              <option value="pid">PID</option>
            </select>
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {error && (
          <div className="px-4 py-6 text-[12px] text-red-300/80 font-mono">{error}</div>
        )}
        {!error && filtered.length === 0 && (
          <div className="px-4 py-10 text-center text-[12px] text-white/30 font-mono">
            {loading ? "Loading…" : "No processes match the current filter."}
          </div>
        )}
        <ul>
          <AnimatePresence initial={false}>
            {filtered.map((p) => (
              <motion.li
                key={p.pid}
                layout="position"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4, transition: { duration: 0.12 } }}
                transition={{
                  opacity: { duration: 0.16 },
                  y:       { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
                  layout:  { type: "spring", stiffness: 420, damping: 38 },
                }}
                className={cn(
                  "px-4 py-2 hover:bg-white/[0.03] cursor-pointer border-b border-white/[0.04] last:border-b-0",
                  picked?.pid === p.pid && "bg-white/[0.05]",
                )}
                onClick={() => onPick(p)}
                title={p.path}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate text-[13px] flex-1 min-w-0">{p.name}</span>
                  {p.elevated && (
                    <span title="elevated" className="text-amber-400/70"><Lock size={11} /></span>
                  )}
                  <span className="font-mono text-[10px] text-white/30">PID {p.pid}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-3 font-mono text-[10px] text-white/35">
                  <span className="flex items-center gap-1"><Cpu size={9} /> {p.bitness}</span>
                  <span>{p.threads} thr</span>
                  <span>sid {p.sessionId}</span>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-white"
      />
      {label}
    </label>
  );
}
