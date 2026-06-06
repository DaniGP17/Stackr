"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { rpc, type ThreadList, type ThreadEntry, type FlatProfile } from "@/lib/bridge";
import { useSettings } from "@/lib/settings";
import { threadAliasKey, saveThreadAlias } from "@/lib/aliases";

function priorityLabel(p: number): string {
  if (p <= -15) return "Idle";
  if (p <= -2)  return "Lowest";
  if (p === -1) return "Below Normal";
  if (p === 0)  return "Normal";
  if (p === 1)  return "Above Normal";
  if (p >= 2 && p < 15) return "Highest";
  return "Time Critical";
}

function priorityColor(p: number): string {
  if (p >= 15)  return "text-rose-300/90";
  if (p >= 1)   return "text-amber-300/80";
  if (p <= -2)  return "text-white/35";
  return "text-white/55";
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

type ThreadStat = { tid: number; samples: number; cpu100ns: number };

export default function ThreadsView({ pid }: { pid: number | null }) {
  const cfg = useSettings();
  const aliases = cfg.threadAliases;

  const [threadList, setThreadList] = useState<ThreadList | null>(null);
  const [profileThreads, setProfileThreads] = useState<ThreadStat[]>([]);
  const [samplesTotal, setSamplesTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState("");

  const fetchThreads = useCallback(async () => {
    if (pid == null) return;
    setLoading(true);
    setError(null);
    try {
      const list = await rpc.call<ThreadList>("process.threads", { pid });
      setThreadList(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [pid]);

  const fetchProfile = useCallback(async () => {
    if (pid == null) return;
    try {
      const p = await rpc.call<FlatProfile>("analysis.flatProfile", { pid, topN: 1, rebuild: false });
      setProfileThreads(p.threads);
      setSamplesTotal(p.samplesTotal);
    } catch {
      setProfileThreads([]);
      setSamplesTotal(0);
    }
  }, [pid]);

  useEffect(() => {
    setThreadList(null);
    setProfileThreads([]);
    setSamplesTotal(0);
    setError(null);
    if (pid != null) {
      void fetchThreads();
      void fetchProfile();
    }
  }, [pid, fetchThreads, fetchProfile]);

  useEffect(() => {
    if (pid == null) return;
    const off = rpc.on("sampler.stopped", (payload) => {
      const p = payload as { pid?: number };
      if (p?.pid === pid) void fetchProfile();
    });
    return off;
  }, [pid, fetchProfile]);

  function startRename(tid: number) {
    setRenaming(tid);
    setRenameVal(aliases[threadAliasKey(tid)] ?? "");
  }
  function commitRename() {
    if (renaming == null) return;
    saveThreadAlias(aliases, renaming, renameVal);
    setRenaming(null);
  }

  const statByTid = new Map(profileThreads.map((t) => [t.tid, t]));
  const maxSamples = profileThreads.reduce((m, t) => Math.max(m, t.samples), 0);

  const threads: ThreadEntry[] = threadList?.threads ?? [];

  return (
    <div className="h-full p-4 flex flex-col gap-4">
      <div className="card p-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="label">THREADS</p>
          {threadList ? (
            <p className="font-mono text-[12px] text-white/55 mt-1">
              pid {threadList.pid} · {threadList.threads.length} thread{threadList.threads.length !== 1 ? "s" : ""}
              {samplesTotal > 0 && <> · {samplesTotal.toLocaleString()} samples in last capture</>}
            </p>
          ) : (
            <p className="text-[12px] text-white/40 mt-1">
              {pid == null ? "Attach a process to inspect its threads." : "Loading…"}
            </p>
          )}
        </div>
        <button
          className="btn shrink-0"
          onClick={() => { void fetchThreads(); void fetchProfile(); }}
          disabled={loading || pid == null}
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <div className="card flex-1 min-h-0 overflow-hidden flex flex-col">
        {error && <div className="px-4 py-6 text-[12px] text-red-300/80 font-mono">{error}</div>}
        {!error && pid == null && (
          <div className="px-4 py-10 text-center text-[12px] text-white/30 font-mono">
            Attach a process to see its threads.
          </div>
        )}
        {!error && pid != null && threads.length === 0 && !loading && (
          <div className="px-4 py-10 text-center text-[12px] text-white/30 font-mono">
            No threads found.
          </div>
        )}
        {threads.length > 0 && (
          <div className="flex-1 min-h-0 overflow-auto">
            <div className="profile-table" style={{ border: 0, borderRadius: 0 }}>
              <div
                className="profile-row profile-header"
                style={{ gridTemplateColumns: "minmax(0,1fr) 80px 110px 180px 90px" }}
              >
                <div>Name · Native name</div>
                <div>TID</div>
                <div>Priority</div>
                <div>Samples</div>
                <div className="justify-end">CPU Time</div>
              </div>
              {threads.map((t) => {
                const stat = statByTid.get(t.tid);
                const samples = stat?.samples ?? 0;
                const cpu100ns = stat?.cpu100ns ?? 0;
                const pct = samplesTotal > 0 ? (samples / samplesTotal) * 100 : 0;
                const barWidth = maxSamples > 0 ? (samples / maxSamples) * 100 : 0;
                const alias = aliases[threadAliasKey(t.tid)];
                const displayName = alias || t.name || `Thread ${t.tid}`;
                const isRenaming = renaming === t.tid;

                return (
                  <div
                    key={t.tid}
                    className="profile-row"
                    style={{ gridTemplateColumns: "minmax(0,1fr) 80px 110px 180px 90px" }}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      {isRenaming ? (
                        <input
                          autoFocus
                          placeholder={t.name || `Thread ${t.tid}`}
                          className="profile-fn bg-transparent border border-white/25 rounded-sm px-0.5 outline-none selectable w-full"
                          value={renameVal}
                          onChange={(e) => setRenameVal(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            if (e.key === "Escape") setRenaming(null);
                          }}
                          onBlur={commitRename}
                        />
                      ) : (
                        <span
                          className="profile-fn selectable cursor-text"
                          title="Right-click to rename"
                          onContextMenu={(e) => { e.preventDefault(); startRename(t.tid); }}
                        >
                          {displayName}
                        </span>
                      )}
                      {t.name && t.name !== alias && (
                        <span className="profile-module selectable">{t.name}</span>
                      )}
                    </div>

                    <div className="font-mono text-[11px] text-white/45 tabular-nums">
                      {t.tid}
                    </div>

                    <div className={`font-mono text-[11px] tabular-nums ${priorityColor(t.priority)}`}>
                      {priorityLabel(t.priority)}
                    </div>

                    <div className="min-w-0">
                      {samples > 0 ? (
                        <div className="flex items-center gap-2">
                          <div className="profile-bar flex-1" style={{ minWidth: 60 }}>
                            <div className="profile-bar-fill" style={{ width: `${barWidth}%` }} />
                            <div className="profile-bar-label">{pct.toFixed(1)}%</div>
                          </div>
                          <span className="font-mono text-[10px] text-white/40 tabular-nums shrink-0">
                            {samples.toLocaleString()}
                          </span>
                        </div>
                      ) : (
                        <span className="font-mono text-[10px] text-white/25">—</span>
                      )}
                    </div>

                    <div className="justify-end font-mono text-[11px] text-white/55 tabular-nums">
                      {cpu100ns > 0 ? formatCpuTime(cpu100ns) : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <p className="text-[10px] text-white/25 font-mono px-1">
        Right-click a thread name to set an alias · aliases appear in thread dropdowns across all views
      </p>
    </div>
  );
}
