"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Rocket } from "lucide-react";
import { rpc, type LaunchResult } from "@/lib/bridge";

export default function LaunchDialog({
  open,
  onClose,
  onLaunched,
}: {
  open: boolean;
  onClose: () => void;
  onLaunched: (r: LaunchResult, path: string) => void;
}) {
  const [path, setPath] = useState("");
  const [args, setArgs] = useState("");
  const [cwd, setCwd] = useState("");
  const [suspended, setSuspended] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setTimeout(() => firstInput.current?.focus(), 30);
    }
  }, [open]);

  async function submit() {
    if (!path.trim()) {
      setError("Path is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await rpc.call<LaunchResult>("process.launch", {
        path: path.trim(),
        args: args.trim() || undefined,
        cwd: cwd.trim() || undefined,
        startSuspended: suspended,
      });
      onLaunched(r, path.trim());
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            className="card w-[520px] max-w-[90vw] p-5"
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6, transition: { duration: 0.14 } }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="label">LAUNCH</p>
            <h2 className="heading-sm mt-1">Run a new executable</h2>
          </div>
          <button className="text-white/40 hover:text-white" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <Field label="Executable path *">
            <input
              ref={firstInput}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="C:\path\to\app.exe"
              className="input selectable"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Arguments">
            <input
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="--verbose --port 8080"
              className="input selectable"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Working directory (defaults to parent of exe)">
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="C:\path\to"
              className="input selectable"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          <label className="flex items-center gap-2 text-[12px] text-white/60 mt-1">
            <input
              type="checkbox"
              checked={suspended}
              onChange={(e) => setSuspended(e.target.checked)}
            />
            Start suspended (lets you attach sampler before main thread runs)
          </label>

          {error && (
            <div className="text-[12px] text-red-300/80 font-mono break-all">{error}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 mt-5">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            <Rocket size={13} />
            {busy ? "Launching…" : "Launch"}
          </button>
        </div>
      </motion.div>

      <style jsx>{`
        .input {
          background: rgba(0,0,0,0.5);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 0.45rem 0.6rem;
          font-family: var(--font-geist-mono);
          font-size: 12px;
          color: white;
          outline: none;
          width: 100%;
        }
        .input:focus {
          border-color: var(--border-hover);
        }
      `}</style>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="label mb-1">{label}</p>
      {children}
    </div>
  );
}
