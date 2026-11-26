// Docs: https://0xui.io/components/shielded-engine.md
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  SERVER_ACCOUNT,
  createShieldedClient,
  type ReadableStore,
  type ShieldedAccountSnapshot,
  type ShieldedClient,
} from "@/lib/shielded-client";
import type { ShieldedEngine, ShieldedEvent } from "@/lib/shielded-engine";

const ShieldedClientContext = createContext<ShieldedClient | null>(null);

export type ShieldedProviderProps = {
  /** The engine every shielded component below talks to. Create it once, outside render. */
  engine: ShieldedEngine;
  children: ReactNode;
};

/** Gives the shielded components below an engine. Wrap the private part of your app once. */
export function ShieldedProvider({ engine, children }: ShieldedProviderProps) {
  const client = useMemo(() => createShieldedClient(engine), [engine]);
  return <ShieldedClientContext.Provider value={client}>{children}</ShieldedClientContext.Provider>;
}

/** The engine and its stores, from the nearest ShieldedProvider. */
export function useShieldedClient() {
  const client = useContext(ShieldedClientContext);
  if (!client) {
    throw new Error("useShieldedEngine must be used inside <ShieldedProvider>.");
  }
  return client;
}

/** The engine from the nearest ShieldedProvider. */
export function useShieldedEngine() {
  return useShieldedClient().engine;
}

/**
 * Read a shielded store and re-render when it changes. `serverValue` is used
 * during server render and hydration, so private state never reaches the HTML.
 */
export function useShieldedStore<T>(store: ReadableStore<T>, serverValue: T) {
  return useSyncExternalStore(store.subscribe, store.get, () => serverValue);
}

/**
 * Read one piece of engine state and re-render when `event` fires.
 *
 * `read` must return a primitive or a reference that stays the same until
 * the state changes (the engine getters do). `serverValue` is used during
 * server render and hydration, so private state never reaches the HTML.
 */
export function useShieldedState<T>(
  event: ShieldedEvent,
  read: (engine: ShieldedEngine) => T,
  serverValue: T,
) {
  const engine = useShieldedEngine();
  const subscribe = useCallback(
    (listener: () => void) => engine.subscribe(event, listener),
    [engine, event],
  );
  return useSyncExternalStore(
    subscribe,
    () => read(engine),
    () => serverValue,
  );
}

/** The private account: whether one exists and is unlocked, and its private address. */
export function useShieldedAccount(): ShieldedAccountSnapshot {
  return useShieldedStore(useShieldedClient().account, SERVER_ACCOUNT);
}
