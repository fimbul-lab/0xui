import type { ShieldedAccountStatus, ShieldedEngine, ShieldedEvent } from "@/lib/shielded-engine";

/** A value to read, and a way to hear when it changes. React reads it with `useSyncExternalStore`. */
export type ReadableStore<T> = {
  get(): T;
  subscribe(listener: () => void): () => void;
};

export type ShieldedAccountSnapshot = {
  status: ShieldedAccountStatus;
  /** Private address, or null unless unlocked. */
  address: string | null;
};

/** What the account looks like before the browser has read it, e.g. in server HTML. */
export const SERVER_ACCOUNT: ShieldedAccountSnapshot = { status: "none", address: null };

export type ShieldedClient = {
  engine: ShieldedEngine;
  /** The private account: whether one exists and is unlocked, and its private address. */
  account: ReadableStore<ShieldedAccountSnapshot>;
  /**
   * One piece of engine state as a store, announced by `event`. `read` must
   * return a primitive or a reference that stays the same until the state
   * changes (the engine getters do).
   */
  select<T>(event: ShieldedEvent, read: (engine: ShieldedEngine) => T): ReadableStore<T>;
};

/** Wraps an engine in stores a UI can read. Framework-free. */
export function createShieldedClient(engine: ShieldedEngine): ShieldedClient {
  const select = <T>(event: ShieldedEvent, read: (engine: ShieldedEngine) => T) => ({
    get: () => read(engine),
    subscribe: (listener: () => void) => engine.subscribe(event, listener),
  });

  let account: ShieldedAccountSnapshot = SERVER_ACCOUNT;
  const readAccount = () => {
    const status = engine.account.status();
    const address = engine.account.address();
    if (status !== account.status || address !== account.address) {
      account = { status, address };
    }
    return account;
  };

  return { engine, account: select("account", readAccount), select };
}
