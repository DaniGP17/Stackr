import type { View } from "@/components/Sidebar";

export type NavTarget = { module: string; fn: string; addr: number };
type Listener = (view: View, target: NavTarget) => void;

class NavigationStore {
  private listeners = new Set<Listener>();

  navigate(view: View, target: NavTarget) {
    for (const cb of this.listeners) cb(view, target);
  }

  on(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

export const nav = new NavigationStore();
