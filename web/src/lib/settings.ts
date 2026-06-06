import { useEffect, useState } from "react";

export type UnresolvedFormat = "sub" | "hex" | "hide";

export type Settings = {
  defaultSamplingHz: number;
  defaultMaxDepth:   number;
  defaultDurationMs: number;

  flatTopN:            number;
  callTreeMaxDepth:    number;
  callTreeMinSamples:  number;
  sourceContextLines:  number;
  disasmDefaultBytes:  number;

  zoomFactor:         number;
  unresolvedFormat:   UnresolvedFormat;
  showElevatedOnly:   boolean;
  autoPickTopThread:  boolean;

  symbolExtraPaths:      string[];
  symbolIncludeMsServer: boolean;
  functionAliases: Record<string, string>;
  threadAliases: Record<string, string>;
};

export const DEFAULTS: Settings = {
  defaultSamplingHz:   1000,
  defaultMaxDepth:     64,
  defaultDurationMs:   0,

  flatTopN:            200,
  callTreeMaxDepth:    32,
  callTreeMinSamples:  1,
  sourceContextLines:  10,
  disasmDefaultBytes:  256,

  zoomFactor:          1.25,
  unresolvedFormat:    "sub",
  showElevatedOnly:    false,
  autoPickTopThread:   true,

  symbolExtraPaths:      [],
  symbolIncludeMsServer: true,
  functionAliases: {},
  threadAliases: {},
};

const STORAGE_KEY = "stackr.settings.v1";

type Listener = (s: Settings) => void;

class SettingsStore {
  private state: Settings = DEFAULTS;
  private listeners = new Set<Listener>();

  constructor() {
    this.state = this.load();
  }

  get(): Settings {
    return this.state;
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]) {
    if (Object.is(this.state[key], value)) return;
    this.state = { ...this.state, [key]: value };
    this.persist();
    for (const cb of this.listeners) cb(this.state);
  }

  reset() {
    this.state = { ...DEFAULTS };
    this.persist();
    for (const cb of this.listeners) cb(this.state);
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private load(): Settings {
    if (typeof window === "undefined") return DEFAULTS;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return DEFAULTS;
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return { ...DEFAULTS, ...parsed };
    } catch {
      return DEFAULTS;
    }
  }

  private persist() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
    }
  }
}

export const settings = new SettingsStore();

export function useSettings(): Settings {
  const [s, setS] = useState(settings.get());
  useEffect(() => settings.subscribe(setS), []);
  return s;
}

export function readSettings(): Settings {
  return settings.get();
}
