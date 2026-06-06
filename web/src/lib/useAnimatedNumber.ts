import { useEffect, useRef, useState } from "react";

export function useAnimatedNumber(target: number, durationMs = 300): number {
  const [displayed, setDisplayed] = useState(target);
  const currentRef = useRef(target);

  useEffect(() => {
    const from  = currentRef.current;
    const to    = target;
    const start = performance.now();
    let rafId   = 0;

    const tick = () => {
      const t      = Math.min(1, (performance.now() - start) / durationMs);
      const eased  = 1 - Math.pow(1 - t, 3);
      const value  = from + (to - from) * eased;
      currentRef.current = value;
      setDisplayed(value);
      if (t < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [target, durationMs]);

  return displayed;
}

export function useLiveElapsed(running: boolean, finalMs: number): number {
  const [elapsed, setElapsed] = useState(finalMs);
  const startRef = useRef<number | null>(null);
  const finalRef = useRef(finalMs);
  finalRef.current = finalMs;

  useEffect(() => {
    if (!running) {
      startRef.current = null;
      setElapsed(finalRef.current);
      return;
    }
    startRef.current = performance.now();
    let rafId = 0;
    const tick = () => {
      const s = startRef.current;
      if (s == null) return;
      setElapsed(performance.now() - s);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [running]);

  return elapsed;
}
