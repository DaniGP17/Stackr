"use client";

import { useEffect, useState } from "react";
import { rpc, type SystemInfo } from "@/lib/bridge";

export default function TitleBar() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [connected, setConnected] = useState<boolean>(false);

  useEffect(() => {
    setConnected(rpc.isConnected);
    if (!rpc.isConnected) return;
    rpc.call<SystemInfo>("system.info").then(setInfo).catch(() => setInfo(null));
    const start = performance.now();
    rpc.call<string>("ping").then(() => setPingMs(performance.now() - start));
  }, []);

  return (
    <div className="app-titlebar flex items-center justify-between px-4 border-b border-[var(--border)]">
      <div className="flex items-center gap-3">
        <span className="label">STACKR</span>
        <span className="text-[11px] text-white/30 font-mono">
          {info ? info.version : "—"}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className={`dot ${connected ? "live" : "error"}`} />
        <span className="text-[11px] text-white/40 font-mono">
          {connected ? `host bridge${pingMs != null ? ` · ${pingMs.toFixed(1)}ms` : ""}` : "host bridge unavailable"}
        </span>
      </div>
    </div>
  );
}
