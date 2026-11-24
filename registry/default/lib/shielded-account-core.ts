import { createStore } from "@/lib/0xui-store";
import type { ShieldedAccountStatus, ShieldedEngine } from "@/lib/shielded-engine";

export type ShieldedAccountPhase =
  /** No private account on this device. */
  | "none"
  | "creating"
  /** Created. The recovery phrase is on screen until the user confirms they saved it. */
  | "backup"
  | "importing"
  | "locked"
  | "unlocking"
  | "unlocked";

type Busy = "creating" | "importing" | "unlocking";

export type ShieldedAccountFlowState = {
  phase: ShieldedAccountPhase;
  /** Private address, or null unless unlocked. */
  address: string | null;
  /** The recovery phrase, only while `phase` is "backup". */
  mnemonic: string | undefined;
  /** Why the last action failed, e.g. a wrong password. Cleared by the next action. */
  error: Error | undefined;
};

/** The flow before the browser has read the account, e.g. in server HTML. */
export const SERVER_ACCOUNT_FLOW: ShieldedAccountFlowState = {
  phase: "none",
  address: null,
  mnemonic: undefined,
  error: undefined,
};

export type ShieldedAccountFlow = {
  get(): ShieldedAccountFlowState;
  subscribe(listener: () => void): () => void;
  /** Create a new account. Slow: the phase is "creating" for several seconds. Resolves true when it worked. */
  create(password: string): Promise<boolean>;
  /** The user has saved the phrase. Drops it from memory. */
  confirmBackup(): void;
  /** Restore an account from its recovery phrase. */
  importAccount(phrase: string, password: string): Promise<boolean>;
  unlock(password: string): Promise<boolean>;
  lock(): void;
  clearError(): void;
};

const toError = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)));

/**
 * Create, import, unlock and lock the private account. The engine keeps the
 * recovery phrase; this holds it only between `create` and `confirmBackup`,
 * so it can be shown once. Framework-free.
 */
export function createShieldedAccountFlow(engine: ShieldedEngine): ShieldedAccountFlow {
  let busy: Busy | undefined;
  let mnemonic: string | undefined;
  let error: Error | undefined;

  const read = (): ShieldedAccountFlowState => {
    const status: ShieldedAccountStatus = engine.account.status();
    return {
      phase: busy ?? (mnemonic !== undefined ? "backup" : status),
      address: engine.account.address(),
      mnemonic,
      error,
    };
  };

  const store = createStore(read(), (store) => {
    store.set(read());
    return engine.subscribe("account", () => store.set(read()));
  });
  const update = () => store.set(read());

  /** Run one engine call. Resolves true when it worked; a failure lands in `error`. */
  const run = async (kind: Busy, action: () => Promise<void>) => {
    error = undefined;
    busy = kind;
    update();
    try {
      await action();
      return true;
    } catch (cause) {
      error = toError(cause);
      return false;
    } finally {
      busy = undefined;
      update();
    }
  };

  return {
    get: store.get,
    subscribe: store.subscribe,
    create: (password) =>
      run("creating", async () => {
        mnemonic = (await engine.account.create(password)).mnemonic;
      }),
    confirmBackup() {
      mnemonic = undefined;
      update();
    },
    importAccount: (phrase, password) =>
      run("importing", () => engine.account.import(phrase, password)),
    unlock: (password) => run("unlocking", () => engine.account.unlock(password)),
    lock() {
      mnemonic = undefined;
      error = undefined;
      engine.account.lock();
      update();
    },
    clearError() {
      error = undefined;
      update();
    },
  };
}

export const MIN_PASSWORD_LENGTH = 8;

/** Why a new password can't be used yet, as button text, or undefined when it's fine. */
export function passwordBlocker(password: string, confirmation: string) {
  if (!password) return "Enter a password";
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password !== confirmation) return "Passwords don't match";
  return undefined;
}

/** The words of a typed recovery phrase, whatever the spacing or casing. */
export function phraseWords(text: string) {
  return text.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Why a typed recovery phrase can't be used yet, or undefined when the word count fits. */
export function phraseBlocker(text: string) {
  const count = phraseWords(text).length;
  if (count === 0) return "Enter your recovery phrase";
  if (count !== 12 && count !== 24) return `Enter all 12 or 24 words (${count} so far)`;
  return undefined;
}
