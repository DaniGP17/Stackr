"use client";

import { useEffect, useState } from "react";
import Sidebar, { type View } from "@/components/Sidebar";
import TitleBar from "@/components/TitleBar";
import StatusBar from "@/components/StatusBar";
import CaptureView from "@/components/CaptureView";
import FlatProfileView from "@/components/FlatProfile";
import CallTreeView from "@/components/CallTreeView";
import FlamegraphView from "@/components/FlamegraphView";
import SourceView from "@/components/SourceView";
import SettingsView from "@/components/SettingsView";
import ThreadsView from "@/components/ThreadsView";
import ModulesView from "@/components/ModulesView";
import { rpc } from "@/lib/bridge";
import { settings } from "@/lib/settings";
import { nav } from "@/lib/navigation";

export default function Home() {
  const [view, setView] = useState<View>("capture");
  const [lastPid, setLastPid] = useState<number | null>(null);

  useEffect(() => {
    rpc.call("system.setZoom", { factor: settings.get().zoomFactor }).catch(() => {});
  }, []);

  useEffect(() => nav.on((view) => setView(view)), []);

  useEffect(() => {
    const push = () => {
      const s = settings.get();
      rpc.call("symbols.setConfig", {
        extraPaths: s.symbolExtraPaths,
        includeMsServer: s.symbolIncludeMsServer,
      }).catch(() => {});
    };
    push();
    return settings.subscribe(push);
  }, []);

  return (
    <div className="app-shell">
      <TitleBar />
      <Sidebar current={view} onSelect={setView} />
      <main className="app-main">
        <div className={view === "capture" ? "h-full" : "hidden"}>
          <CaptureView onAttachedPid={setLastPid} />
        </div>
        <div className={view === "threads" ? "h-full" : "hidden"}>
          <ThreadsView pid={lastPid} />
        </div>
        <div className={view === "modules" ? "h-full" : "hidden"}>
          <ModulesView pid={lastPid} />
        </div>
        <div className={view === "flat" ? "h-full" : "hidden"}>
          <FlatProfileView pid={lastPid} />
        </div>
        <div className={view === "tree" ? "h-full" : "hidden"}>
          <CallTreeView pid={lastPid} />
        </div>
        <div className={view === "flame" ? "h-full" : "hidden"}>
          <FlamegraphView pid={lastPid} />
        </div>
        <div className={view === "source" ? "h-full" : "hidden"}>
          <SourceView pid={lastPid} />
        </div>
        <div className={view === "settings" ? "h-full" : "hidden"}>
          <SettingsView />
        </div>
      </main>
      <StatusBar />
    </div>
  );
}
