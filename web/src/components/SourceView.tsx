"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, RefreshCw, FileX, FileCode } from "lucide-react";
import {
  rpc,
  type FlatProfile, type FlatEntry,
  type SourceListing,
} from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { readSettings, useSettings } from "@/lib/settings";
import { Select } from "./Select";
import { nav } from "@/lib/navigation";

export default function SourceView({ pid }: { pid: number | null }) {
  const [profile, setProfile]         = useState<FlatProfile | null>(null);
  const [profileLoading, setProfLoad] = useState(false);
  const [selectedTid, setSelectedTid] = useState<number | null>(null);
  const [selectedAddr, setSelectedAddr] = useState<number | null>(null);
  const [listing, setListing]         = useState<SourceListing | null>(null);
  const [listingLoading, setListLoad] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [error, setError]             = useState<string | null>(null);

  const autoSelectedRef = useRef(false);
  const selectedTidRef  = useRef<number | null>(null);

  useEffect(() => { selectedTidRef.current = selectedTid; }, [selectedTid]);

  const loadProfile = useCallback(async (tid: number | null, rebuild: boolean) => {
    if (pid == null) { setProfile(null); return null; }
    setProfLoad(true); setError(null);
    try {
      const params: Record<string, unknown> = { pid, topN: 500, rebuild };
      if (tid != null) params.tid = tid;
      const p = await rpc.call<FlatProfile>("analysis.flatProfile", params);
      setProfile(p);
      return p;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setProfLoad(false);
    }
  }, [pid]);

  const loadListing = useCallback(async (addr: number, tid: number | null) => {
    if (pid == null) { setListing(null); return; }
    setListLoad(true);
    try {
      const params: Record<string, unknown> = {
        pid, addr, contextLines: readSettings().sourceContextLines,
      };
      if (tid != null) params.tid = tid;
      const l = await rpc.call<SourceListing>("analysis.sourceView", params);
      setListing(l);
    } catch (e) {
      setError((e as Error).message);
      setListing(null);
    } finally {
      setListLoad(false);
    }
  }, [pid]);

  useEffect(() => nav.on((view, target) => {
    if (view !== "source") return;
    if (target.addr !== 0) {
      setSelectedAddr(target.addr);
      void loadListing(target.addr, selectedTidRef.current);
    } else {
      setPickerQuery(target.fn);
    }
  }), [loadListing]);

  async function autoFetchAfterStop() {
    if (pid == null) return;
    const all = await loadProfile(null, true);
    if (!all) return;
    let tid = selectedTid;
    if (all.threads.length > 0) {
      tid = all.threads[0].tid;
      setSelectedTid(tid);
    }
    const filtered = await loadProfile(tid, false);
    if (!filtered) return;
    const top = topSelfEntry(filtered.entries);
    if (top) {
      setSelectedAddr(top.addr);
      void loadListing(top.addr, tid);
    }
  }

  useEffect(() => {
    if (pid == null) return;
    const off = rpc.on("sampler.stopped", (payload) => {
      const p = payload as { pid?: number };
      if (p?.pid === pid) {
        autoSelectedRef.current = false;
        void autoFetchAfterStop();
      }
    });
    return off;
  }, [pid, selectedTid]);

  useEffect(() => {
    setProfile(null);
    setListing(null);
    setSelectedAddr(null);
    setSelectedTid(null);
    setPickerQuery("");
    autoSelectedRef.current = false;
  }, [pid]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "r" || e.key === "R") { e.preventDefault(); void autoFetchAfterStop(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pid, selectedTid]);

  useEffect(() => {
    if (pid == null) return;
    (async () => {
      const all = await loadProfile(null, false);
      if (!all || autoSelectedRef.current) return;
      autoSelectedRef.current = true;
      let tid: number | null = null;
      if (all.threads.length > 0) {
        tid = all.threads[0].tid;
        setSelectedTid(tid);
      }
      const filtered = await loadProfile(tid, false);
      if (!filtered) return;
      const top = topSelfEntry(filtered.entries);
      if (top) {
        setSelectedAddr(top.addr);
        void loadListing(top.addr, tid);
      }
    })();
  }, [pid]);

  function changeSelectedTid(tid: number | null) {
    setSelectedTid(tid);
    if (pid == null) return;
    (async () => {
      const filtered = await loadProfile(tid, false);
      if (!filtered) return;
      if (selectedAddr != null && filtered.entries.some((e) => e.addr === selectedAddr)) {
        void loadListing(selectedAddr, tid);
      } else {
        const top = topSelfEntry(filtered.entries);
        if (top) {
          setSelectedAddr(top.addr);
          void loadListing(top.addr, tid);
        } else {
          setListing(null);
        }
      }
    })();
  }

  function pickEntry(entry: FlatEntry) {
    setSelectedAddr(entry.addr);
    void loadListing(entry.addr, selectedTid);
  }

  const candidates = useMemo(() => {
    if (!profile) return [] as FlatEntry[];
    const q = pickerQuery.trim().toLowerCase();
    let list = profile.entries.filter((e) => e.self > 0);
    if (q) {
      list = list.filter(
        (e) => e.function.toLowerCase().includes(q) || e.module.toLowerCase().includes(q),
      );
    }
    return list.slice(0, 200);
  }, [profile, pickerQuery]);

  const maxLineHits = useMemo(
    () => listing?.lines.reduce((m, l) => Math.max(m, l.hits), 0) ?? 0,
    [listing],
  );

  return (
    <div className="h-full p-4 flex flex-col gap-4 min-h-0">
      <div className="card p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="label">SOURCE</p>
          {profile ? (
            <p className="font-mono text-[12px] text-white/55 mt-1 truncate">
              pid {profile.pid} · {profile.samplesTotal.toLocaleString()} samples · {candidates.length.toLocaleString()} candidate fns
              {profile.samplesUnresolved > 0 && (
                <> · <span className="text-amber-300/70">{profile.samplesUnresolved.toLocaleString()} unresolved</span></>
              )}
            </p>
          ) : (
            <p className="text-[12px] text-white/40 mt-1">
              {pid == null ? "Attach a process and capture samples first." : "No data yet."}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {profile && profile.threads.length > 0 && (
            <ThreadDropdown
              threads={profile.threads}
              selectedTid={selectedTid}
              onSelect={changeSelectedTid}
              disabled={profileLoading || listingLoading}
            />
          )}
          <button
            className="btn !py-1 !px-2 !text-[11px]"
            disabled={pid == null || profileLoading}
            onClick={() => void loadProfile(selectedTid, true)}
            title="Re-aggregate from the latest capture"
          >
            <RefreshCw size={11} className={profileLoading ? "animate-spin" : ""} />
            Rebuild
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-rows-1 gap-4"
           style={{ gridTemplateColumns: "minmax(0, 360px) minmax(0, 1fr)" }}>
        <div className="card flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-[var(--border)] flex items-center gap-2">
            <Search size={13} className="text-white/30" />
            <input
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              placeholder="Filter functions"
              className="bg-transparent outline-none text-[12px] flex-1 selectable"
            />
            <span className="font-mono text-[10px] text-white/30">{candidates.length}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {error && (
              <div className="px-3 py-4 text-[11px] text-red-300/80 font-mono">{error}</div>
            )}
            {!error && candidates.length === 0 && (
              <div className="px-3 py-6 text-center text-[11px] text-white/30 font-mono">
                {profileLoading ? "Loading…" : "No candidates."}
              </div>
            )}
            {!error && candidates.map((e) => {
              const selected = selectedAddr === e.addr;
              const selfPct = profile && profile.samplesTotal > 0
                ? (e.self / profile.samplesTotal) * 100 : 0;
              return (
                <button
                  key={`${e.addr}-${e.function}`}
                  onClick={() => pickEntry(e)}
                  className={cn(
                    "w-full text-left px-3 py-1.5 border-b border-white/[0.04] last:border-b-0",
                    "hover:bg-white/[0.03] transition-colors",
                    selected && "bg-white/[0.06]",
                  )}
                  title={e.function}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate text-[12px]">{e.function || "<unresolved>"}</span>
                    <span className="font-mono text-[10px] text-white/50 ml-auto tabular-nums">
                      {selfPct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="font-mono text-[10px] text-white/30 truncate">
                    {e.module || "—"} · {e.self.toLocaleString()} self
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="card flex flex-col min-h-0">
          <SourcePanel
            listing={listing}
            loading={listingLoading}
            maxHits={maxLineHits}
            hasTarget={pid != null}
            hasSelection={selectedAddr != null}
          />
        </div>
      </div>
    </div>
  );
}

function topSelfEntry(entries: FlatEntry[]): FlatEntry | null {
  let top: FlatEntry | null = null;
  for (const e of entries) {
    if (e.self <= 0) continue;
    if (!top || e.self > top.self) top = e;
  }
  return top;
}

function SourcePanel({
  listing, loading, maxHits, hasTarget, hasSelection,
}: {
  listing: SourceListing | null;
  loading: boolean;
  maxHits: number;
  hasTarget: boolean;
  hasSelection: boolean;
}) {
  if (loading) {
    return <Placeholder text="Reading source…" />;
  }
  if (!hasTarget) {
    return <Placeholder text="Attach a process to begin." />;
  }
  if (!hasSelection || !listing) {
    return <Placeholder text="Pick a function from the list on the left." />;
  }

  return (
    <>
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-baseline gap-3 min-w-0">
          <p className="text-[13px] font-medium truncate" title={listing.function}>
            {listing.function || "<unresolved>"}
          </p>
          <span className="font-mono text-[11px] text-white/40 truncate">
            {listing.module || "—"} · 0x{listing.functionAddr.toString(16).toUpperCase()}
          </span>
        </div>
        <p className="font-mono text-[11px] text-white/55 mt-1 truncate" title={listing.file}>
          {listing.fileAvailable ? <FileCode size={11} className="inline mr-1.5 -mt-px text-emerald-300/70" />
                                  : <FileX   size={11} className="inline mr-1.5 -mt-px text-amber-300/70" />}
          {listing.file || "(no source file)"}
          {listing.totalHits > 0 && (
            <> · <span className="text-white/70">{listing.totalHits.toLocaleString()} hits</span></>
          )}
          {listing.samplesNoLineInfo > 0 && (
            <> · <span className="text-amber-300/70">{listing.samplesNoLineInfo.toLocaleString()} w/o line</span></>
          )}
        </p>
        {listing.otherFiles.length > 0 && (
          <details className="mt-1 text-[10px] text-white/45 font-mono">
            <summary className="cursor-pointer hover:text-white/65">
              {listing.otherFiles.length} other file{listing.otherFiles.length === 1 ? "" : "s"} (inlined hits)
            </summary>
            <ul className="mt-1 pl-3 space-y-0.5">
              {listing.otherFiles.map((f) => (
                <li key={f.file} className="truncate" title={f.file}>
                  {f.file} — {f.hits.toLocaleString()}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {!listing.fileAvailable ? (
        <div className="flex-1 min-h-0 flex items-center justify-center p-8 text-center">
          <div className="font-mono text-[12px] text-white/50 max-w-md">
            <FileX size={20} className="mx-auto mb-2 text-amber-300/70" />
            <div className="mb-1.5">{listing.fileError || "Source file not available."}</div>
            {listing.file && (
              <div className="text-[10px] text-white/35 break-all selectable">
                The PDB pointed to:<br />
                <span className="text-white/55">{listing.file}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto font-mono text-[12px]">
          <table className="min-w-full">
            <tbody>
              {listing.lines.map((l) => {
                const heat = maxHits > 0 ? l.hits / maxHits : 0;
                const hot  = l.hits > 0;
                return (
                  <tr key={l.line} className={cn("hover:bg-white/[0.03]", hot && "bg-white/[0.015]") }>
                    <td className="px-2 py-[2px] text-right text-white/30 select-none tabular-nums w-12">
                      {l.line}
                    </td>
                    <td className="px-2 py-[2px] text-right tabular-nums w-14 select-none">
                      {hot ? (
                        <span className="text-amber-300/80 text-[11px]">{l.hits.toLocaleString()}</span>
                      ) : (
                        <span className="text-white/15">·</span>
                      )}
                    </td>
                    <td className="w-20 px-1 py-[2px] select-none">
                      {hot && (
                        <div className="h-3 rounded relative overflow-hidden bg-white/[0.04]">
                          <div
                            className="absolute inset-y-0 left-0 rounded"
                            style={{ width: `${heat * 100}%`, background: heatGradient(heat) }}
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-[2px] whitespace-pre selectable text-white/85">
                      {l.code}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-[12px] text-white/30 font-mono p-8">
      {text}
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

function heatGradient(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const hue = 120 - 120 * clamped;
  return `hsl(${hue}, 70%, 45%)`;
}
