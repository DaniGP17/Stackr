"use client";

import { Activity, BarChart3, FileText, GitBranch, Settings, Cpu, Layers, Box } from "lucide-react";
import { cn } from "@/lib/cn";

export type View = "capture" | "threads" | "modules" | "flat" | "tree" | "flame" | "source" | "settings";

const ITEMS: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: "capture",  label: "Capture",   icon: <Activity   size={16} /> },
  { id: "threads",  label: "Threads",   icon: <Layers     size={16} /> },
  { id: "modules",  label: "Modules",   icon: <Box        size={16} /> },
  { id: "flat",     label: "Flat",      icon: <BarChart3  size={16} /> },
  { id: "tree",     label: "Call tree", icon: <GitBranch  size={16} /> },
  { id: "flame",    label: "Flame",     icon: <Cpu        size={16} /> },
  { id: "source",   label: "Source",    icon: <FileText   size={16} /> },
  { id: "settings", label: "Settings",  icon: <Settings   size={16} /> },
];

export default function Sidebar({
  current,
  onSelect,
}: {
  current: View;
  onSelect: (v: View) => void;
}) {
  return (
    <aside className="app-sidebar flex flex-col">
      <nav className="pt-4 px-2 flex-1 flex flex-col gap-0.5">
        {ITEMS.map((it) => (
          <button
            key={it.id}
            className={cn("nav-btn", current === it.id && "active")}
            onClick={() => onSelect(it.id)}
          >
            {it.icon}
            <span>{it.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
