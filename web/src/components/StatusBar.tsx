"use client";

export default function StatusBar({ message }: { message?: string }) {
  return (
    <div className="app-statusbar flex items-center justify-between px-3 font-mono text-[10px] text-white/30 bg-black/40">
      <span>{message ?? "idle"}</span>

    </div>
  );
}
