import type { OpenEvent } from "./types";

/**
 * A tiny event hook for the open moment. The intro (Paz the Conductor) will
 * subscribe to this later: "open-start" when a box is picked up, "open-claimed"
 * when the answer is in, "open-burst" at the burst, "open-done" when the last
 * item has landed, "open-cancel" when the player puts the box back.
 *
 * The "first time Play is entered" and "welcome boxes are done" moments belong
 * to the Play shell, which knows the history; it should emit its own.
 */
type Listener = (e: OpenEvent) => void;
const listeners = new Set<Listener>();

export function onOpenEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitOpenEvent(e: OpenEvent) {
  listeners.forEach((fn) => {
    try {
      fn(e);
    } catch (err) {
      console.warn("open event listener", err);
    }
  });
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent("hz:play-open", { detail: e }));
    } catch {
      /* no CustomEvent */
    }
  }
}
