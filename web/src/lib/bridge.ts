type Listener = (payload: unknown) => void;
type Resolver = { resolve: (v: unknown) => void; reject: (e: Error) => void };

declare global {
  interface Window {
    chrome?: {
      webview?: {
        postMessage: (msg: unknown) => void;
        addEventListener: (t: string, cb: (ev: { data: unknown }) => void) => void;
      };
    };
    __stackrSend?: (msg: unknown) => void;
  }
}

class RpcClient {
  private nextId = 1;
  private pending = new Map<string, Resolver>();
  private listeners = new Map<string, Set<Listener>>();
  private ready: boolean;

  constructor() {
    this.ready = typeof window !== "undefined" && !!window.chrome?.webview;
    if (typeof window !== "undefined") {
      window.addEventListener("stackr:message", (ev) => {
        const e = ev as CustomEvent<unknown>;
        this.handleIncoming(e.detail);
      });
    }
  }

  get isConnected(): boolean {
    return this.ready;
  }

  call<TResult = unknown>(method: string, params?: unknown): Promise<TResult> {
    if (!this.ready) {
      return Promise.reject(new Error("WebView2 bridge unavailable"));
    }
    const id = String(this.nextId++);
    const envelope = { id, method, params };
    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      window.chrome!.webview!.postMessage(envelope);
    });
  }

  on(event: string, cb: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  }

  private handleIncoming(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const msg = data as Record<string, unknown>;
    if ("event" in msg && typeof msg.event === "string") {
      const set = this.listeners.get(msg.event);
      if (set) for (const cb of set) cb(msg.payload);
      return;
    }
    if ("id" in msg && typeof msg.id === "string") {
      const r = this.pending.get(msg.id);
      if (!r) return;
      this.pending.delete(msg.id);
      if ("error" in msg) r.reject(new Error(String(msg.error)));
      else r.resolve(msg.result);
    }
  }
}

export const rpc = new RpcClient();

export type Bitness = "x64" | "x86" | "arm64" | "unknown";

export type ProcessInfo = {
  pid: number;
  parentPid: number;
  name: string;
  path: string;
  threads: number;
  sessionId: number;
  bitness: Bitness;
  elevated: boolean;
  accessible: boolean;
};

export type AttachResult   = { pid: number; attached: boolean };
export type DetachResult   = { detached: boolean };
export type LaunchOptions  = {
  path: string;
  args?: string;
  cwd?: string;
  startSuspended?: boolean;
};
export type LaunchResult   = { pid: number; tid: number };

export type SystemInfo = {
  version: string;
};

export type SamplerStats = {
  pid: number;
  frequencyHz: number;
  samplesTotal: number;
  samplesDropped: number;
  threadsActive: number;
  threadsSeen: number;
  walkFailures: number;
  elapsedMs: number;
  running: boolean;
};

export type SamplerStartParams = {
  pid: number;
  frequencyHz?: number;
  durationMs?: number;
  maxDepth?: number;
};

export type FlatEntry = {
  function: string;
  module: string;
  addr: number;
  self: number;
  total: number;
};

export type ThreadStat = {
  tid: number;
  samples: number;
  cpu100ns: number;
};

export type FlatProfile = {
  pid: number;
  tid: number | null;
  samplesTotal: number;
  samplesUnresolved: number;
  elapsedMs: number;
  entryCount: number;
  threads: ThreadStat[];
  entries: FlatEntry[];
};

export type DisasmInstruction = {
  addr: number;
  size: number;
  bytes: string;
  mnemonic: string;
  opStr: string;
};

export type DisasmListing = {
  baseAddr: number;
  bytesRead: number;
  error?: string;
  instructions: DisasmInstruction[];
};

export type CallTreeMode = "topdown" | "bottomup";

export type CallTreeNode = {
  id: number;
  function: string;
  module: string;
  addr: number;
  self: number;
  total: number;
  selfPct: number;
  totalPct: number;
  children: CallTreeNode[];
};

export type CallTree = {
  pid: number;
  tid: number | null;
  mode: CallTreeMode;
  samplesTotal: number;
  samplesUnresolved: number;
  elapsedMs: number;
  nodeCount: number;
  threads: ThreadStat[];
  roots: CallTreeNode[];
};

export type ThreadEntry = {
  tid: number;
  name: string;
  priority: number;
};

export type ThreadList = {
  pid: number;
  threads: ThreadEntry[];
};

export type SourceLine = {
  line: number;
  hits: number;
  code: string;
};

export type SourceFileRef = {
  file: string;
  hits: number;
};

export type SourceListing = {
  pid: number;
  tid: number | null;
  functionAddr: number;
  moduleBase: number;
  function: string;
  module: string;
  file: string;
  fileAvailable: boolean;
  fileError: string;
  startLine: number;
  endLine: number;
  totalHits: number;
  samplesNoLineInfo: number;
  lines: SourceLine[];
  otherFiles: SourceFileRef[];
};
