"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/cn";

export type SelectOption = {
  value: string;
  label: string;
  sub?: string;
};

export function Select({
  value,
  onChange,
  options,
  disabled,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((v) => !v); return; }
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const idx  = options.findIndex((o) => o.value === value);
      const next = e.key === "ArrowDown"
        ? Math.min(options.length - 1, idx + 1)
        : Math.max(0, idx - 1);
      onChange(options[next].value);
    }
  }

  return (
    <div ref={rootRef} className={cn("relative inline-block", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        className={cn(
          "flex items-center gap-1.5 h-[26px] bg-black/40 border rounded-md px-2.5 text-[11px] font-mono text-white/80 outline-none cursor-pointer transition-colors duration-100 whitespace-nowrap select-none",
          open
            ? "border-[var(--border-hover)]"
            : "border-[var(--border)] hover:border-[var(--border-hover)]",
          disabled && "opacity-40 cursor-not-allowed pointer-events-none",
        )}
      >
        <span className="truncate max-w-[200px]">{current?.label ?? value}</span>
        <ChevronDown
          size={10}
          className={cn(
            "shrink-0 text-white/35 transition-transform duration-150 ml-0.5",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          className="absolute z-50 top-full mt-1 left-0 bg-[#0c0c0c] border border-white/10 rounded-lg shadow-2xl py-1"
          style={{ minWidth: "100%", maxHeight: 300, overflowY: "auto" }}
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={cn(
                  "w-full text-left flex items-center gap-2 px-2.5 py-[5px] font-mono text-[11px] transition-colors duration-75 hover:bg-white/[0.06] whitespace-nowrap",
                  active ? "text-white" : "text-white/55 hover:text-white",
                )}
              >
                <span className={cn("w-3 shrink-0 text-white/55", !active && "opacity-0")}>
                  <Check size={10} strokeWidth={2.5} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate leading-snug">{opt.label}</span>
                  {opt.sub && (
                    <span className="block text-[10px] text-white/30 leading-tight">{opt.sub}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
