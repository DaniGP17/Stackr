"use client";

import { useEffect, useState } from "react";
import { X, RefreshCw } from "lucide-react";
import { rpc, type DisasmListing } from "@/lib/bridge";
import { useSettings, readSettings } from "@/lib/settings";
import { resolveAlias } from "@/lib/aliases";
import { Select } from "./Select";

const CONTROL_FLOW = new Set([
  "call", "callq", "jmp", "jmpq",
  "je", "jne", "jz", "jnz", "ja", "jae", "jb", "jbe",
  "jg", "jge", "jl", "jle", "js", "jns", "jo", "jno",
  "jcxz", "jecxz", "jrcxz", "loop", "loope", "loopne",
  "ret", "retq", "retf", "iret", "iretq",
  "syscall", "sysenter", "sysret", "sysexit", "int", "int3",
]);

function classifyMnemonic(m: string): string {
  const lower = m.toLowerCase();
  if (CONTROL_FLOW.has(lower)) {
    if (lower.startsWith("call"))      return "text-amber-300/90";
    if (lower.startsWith("ret"))       return "text-rose-300/90";
    if (lower.startsWith("j"))         return "text-sky-300/90";
    if (lower.startsWith("int"))       return "text-rose-300/90";
    return "text-fuchsia-300/90";
  }
  if (lower === "nop")                 return "text-white/25";
  if (lower.startsWith("mov"))         return "text-white/85";
  if (lower.startsWith("push") ||
      lower.startsWith("pop"))         return "text-emerald-300/80";
  return "text-white/70";
}

function formatAddr(n: number): string {
  return "0x" + n.toString(16).toUpperCase().padStart(16, "0");
}

export default function DisassemblyView({
  pid,
  addr,
  functionName,
  module,
  onClose,
}: {
  pid: number;
  addr: number;
  functionName: string;
  module: string;
  onClose: () => void;
}) {
  const [listing, setListing] = useState<DisasmListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [maxBytes, setMaxBytes] = useState(() => readSettings().disasmDefaultBytes);
  const cfg = useSettings();
  const aliases = cfg.functionAliases;

  async function load(bytes: number) {
    setLoading(true); setError(null);
    try {
      const l = await rpc.call<DisasmListing>("disasm.function", {
        pid, addr, maxBytes: bytes,
      });
      if (l.error) {
        setError(l.error);
        setListing(null);
      } else {
        setListing(l);
      }
    } catch (e) {
      setError((e as Error).message);
      setListing(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(maxBytes);
  }, [pid, addr]);

  return (
    <div className="card flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="label">DISASSEMBLY</p>
          <h3 className="text-[13px] font-medium mt-0.5 truncate" title={functionName}>
            {resolveAlias(aliases, module, functionName)}
          </h3>
          <p className="font-mono text-[10px] text-white/40 mt-0.5 truncate">
            {module || "—"} · {formatAddr(addr)}
          </p>
        </div>
        <button
          className="text-white/40 hover:text-white shrink-0"
          onClick={onClose}
          title="Close"
        >
          <X size={14} />
        </button>
      </div>

      <div className="px-4 py-2 border-b border-[var(--border)] flex items-center gap-3 text-[11px] text-white/55">
        <div className="flex items-center gap-2">
          <span className="label">BYTES</span>
          <Select
            value={String(maxBytes)}
            onChange={(v) => { const n = Number(v); setMaxBytes(n); void load(n); }}
            options={[128, 256, 512, 1024, 2048, 4096].map((n) => ({ value: String(n), label: String(n) }))}
          />
        </div>
        <button
          className="btn !py-0.5 !px-2 !text-[10px] ml-auto"
          onClick={() => load(maxBytes)}
          disabled={loading}
        >
          <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
          Reload
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {error && (
          <div className="px-4 py-6 text-[11px] text-red-300/80 font-mono break-all">
            {error}
          </div>
        )}
        {!error && loading && !listing && (
          <div className="px-4 py-10 text-center text-[11px] text-white/30 font-mono">
            Reading {maxBytes} bytes from target…
          </div>
        )}
        {!error && listing && (
          <div className="font-mono text-[11px] py-1 selectable">
            {listing.instructions.map((ix, i) => {
              const cls = classifyMnemonic(ix.mnemonic);
              return (
                <div
                  key={i}
                  className="grid grid-cols-[170px_140px_60px_minmax(0,1fr)] gap-2 px-4 py-[2px] hover:bg-white/[0.03]"
                >
                  <span className="text-white/30">{formatAddr(ix.addr)}</span>
                  <span className="text-white/45 truncate">{ix.bytes}</span>
                  <span className={cls}>{ix.mnemonic}</span>
                  <span className="text-white/65 truncate" title={ix.opStr}>{ix.opStr}</span>
                </div>
              );
            })}
            <div className="px-4 py-2 mt-1 text-[10px] text-white/30 border-t border-[var(--border)]">
              {listing.instructions.length} instructions · {listing.bytesRead} bytes read
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
