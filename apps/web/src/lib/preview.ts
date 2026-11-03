import { useSyncExternalStore } from "react";

// Whether to show your own share in the grid. Per device, on by default.
const KEY = "sharr.own_preview";
const listeners = new Set<() => void>();

function read() {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

let current = read();

export function setOwnPreview(show: boolean) {
  current = show;
  try {
    localStorage.setItem(KEY, show ? "1" : "0");
  } catch {
    // Private mode etc.: still applies for this page
  }
  listeners.forEach((l) => l());
}

export function useOwnPreview() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
