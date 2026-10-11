import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * `false` during server render and hydration, `true` afterwards.
 * Use it to keep wallet state (which only exists in the browser) out of the
 * server HTML and avoid hydration mismatches. Client-only renders get `true`
 * immediately, with no extra render.
 */
export function useMounted() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
