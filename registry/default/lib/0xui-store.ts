/**
 * The state container behind every 0xui controller. Framework-free: React
 * reads it with `useStore`, and a Vue or Svelte port reads the same
 * `get`/`subscribe` pair.
 *
 * `start` runs when the first listener subscribes and its cleanup when the
 * last one leaves, so a controller only watches wagmi while something renders
 * it, and survives React's double mount in development.
 */
export type Store<S> = {
  /** The current state. The same object until something changes. */
  get(): S;
  /** Merge a patch into the state and notify listeners when anything changed. */
  set(patch: Partial<S> | ((state: S) => Partial<S>)): void;
  /** Call `listener` after every change. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
};

export function createStore<S extends object>(
  initial: S,
  start?: (store: Store<S>) => () => void,
): Store<S> {
  let state = initial;
  let stop: (() => void) | undefined;
  const listeners = new Set<() => void>();

  const store: Store<S> = {
    get: () => state,
    set(patch) {
      const next = typeof patch === "function" ? patch(state) : patch;
      let changed = false;
      for (const key in next) {
        if (!Object.is(next[key], state[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...next };
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && start) stop = start(store);
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) {
          stop?.();
          stop = undefined;
        }
      };
    },
  };
  return store;
}
