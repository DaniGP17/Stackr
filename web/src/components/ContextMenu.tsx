"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

export type ContextMenuItem =
  | { label: string; onClick: () => void; danger?: boolean }
  | { separator: true };

export function ContextMenu({
  x, y, items, onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const itemH = 30;
  const menuH = items.length * itemH + 8;
  const top  = Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 800) - menuH - 8);
  const left = Math.min(x, (typeof window !== "undefined" ? window.innerWidth  : 1400) - 180 - 8);

  return (
    <div
      ref={ref}
      className="fixed z-[200] bg-[#0c0c0c] border border-white/10 rounded-lg shadow-2xl py-1 min-w-[160px]"
      style={{ left, top }}
    >
      {items.map((item, i) => {
        if ("separator" in item) {
          return <div key={i} className="my-1 border-t border-white/[0.06]" />;
        }
        return (
          <button
            key={i}
            type="button"
            onClick={() => { item.onClick(); onClose(); }}
            className={cn(
              "w-full text-left px-3 py-[5px] font-mono text-[11px] transition-colors hover:bg-white/[0.06] whitespace-nowrap",
              item.danger ? "text-red-300/80 hover:text-red-300" : "text-white/65 hover:text-white",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
