import { useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";
import { isOnline, onConnectivityChange } from "@/lib/pwa";

function subscribe(onChange: () => void): () => void {
  const offManager = onlineManager.subscribe(onChange);
  const offBrowser = onConnectivityChange(onChange);
  return () => {
    offManager();
    offBrowser();
  };
}

const snapshot = () => onlineManager.isOnline() && isOnline();

/**
 * Whether the device is online, by both the browser and React Query's view. A paused query is not
 * proof of being offline (a retry also pauses while the tab is unfocused), so read this first.
 */
export function useIsOnline(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
