import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * True once the component renders in the browser (false for a server snapshot).
 * Replaces the `useEffect(() => setMounted(true), [])` pattern, which costs an
 * extra render per mount.
 */
export function useHasMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
