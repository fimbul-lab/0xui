import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  ShieldedAccountStatus,
  ShieldedEngine,
  ShieldedEvent,
} from "@/lib/shielded-engine";

const ShieldedEngineContext = createContext<ShieldedEngine | null>(null);

export type ShieldedProviderProps = {
  /** The engine every shielded component below talks to. Create it once, outside render. */
  engine: ShieldedEngine;
  children: ReactNode;
};

/** Gives the shielded components below an engine. Wrap the private part of your app once. */
export function ShieldedProvider({ engine, children }: ShieldedProviderProps) {
  return (
    <ShieldedEngineContext.Provider value={engine}>{children}</ShieldedEngineContext.Provider>
  );
}

/** The engine from the nearest ShieldedProvider. */
export function useShieldedEngine() {
  const engine = useContext(ShieldedEngineContext);
  if (!engine) {
    throw new Error("useShieldedEngine must be used inside <ShieldedProvider>.");
  }
  return engine;
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
  serverValue: T
) {
  const engine = useShieldedEngine();
  const subscribe = useCallback(
    (listener: () => void) => engine.subscribe(event, listener),
    [engine, event]
  );
  return useSyncExternalStore(
    subscribe,
    () => read(engine),
    () => serverValue
  );
}

/** The private account: whether one exists and is unlocked, and its private address. */
export function useShieldedAccount(): {
  status: ShieldedAccountStatus;
  /** Private address, or null unless unlocked. */
  address: string | null;
} {
  const status = useShieldedState("account", (engine) => engine.account.status(), "none");
  const address = useShieldedState("account", (engine) => engine.account.address(), null);
  return { status, address };
}
