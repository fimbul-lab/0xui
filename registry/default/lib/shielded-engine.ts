// Docs: https://0xui.io/components/shielded-engine.md
import type { Address, Hash, Hex } from "viem";

/**
 * The contract between 0xui's shielded components and a privacy protocol.
 *
 * An engine wraps one protocol SDK (or the in-memory mock) and exposes the
 * same small surface for every protocol. Components only read state through
 * the getters and learn about changes through `subscribe`, so they never see
 * protocol names, SDK events or half-updated state.
 */

/**
 * What a private balance can be used for right now. Only `spendable` funds
 * can be spent. Each engine maps its protocol's own states onto these five.
 */
export type ShieldedBalanceState =
  /** Ready to spend. */
  | "spendable"
  /** Recently shielded and waiting out the protocol's standby period. */
  | "pending"
  /** Proofs for these funds are submitted and being checked. */
  | "proving"
  /** A proof is missing. Retry with `retryProofs`. */
  | "incomplete"
  /** Can't be spent privately. Can only return to the address it came from. */
  | "restricted";

/** Every balance state, in the order components list them. */
export const SHIELDED_BALANCE_STATES = [
  "spendable",
  "pending",
  "proving",
  "incomplete",
  "restricted",
] as const satisfies readonly ShieldedBalanceState[];

/** One token's private balance, split by state. */
export type ShieldedTokenBalance = {
  /** ERC-20 contract. Native currency is held as its wrapped token. */
  token: Address;
  /** Amount in each state, in the token's smallest unit. Every state is present, 0n when empty. */
  amounts: Readonly<Record<ShieldedBalanceState, bigint>>;
};

/**
 * A scan runs in passes. `notes` finds the account's funds; `transactions`
 * syncs the records needed to prove them.
 */
export type ShieldedSyncStage = "notes" | "transactions";

/** The scan passes, in the order they run. */
export const SHIELDED_SYNC_STAGES = [
  "notes",
  "transactions",
] as const satisfies readonly ShieldedSyncStage[];

export type ShieldedSyncStatus = "idle" | "syncing" | "synced" | "error";

/** Where a chain's scan is. */
export type ShieldedSync = {
  /** The pass that is running, or ran last. */
  stage: ShieldedSyncStage;
  status: ShieldedSyncStatus;
  /**
   * 0 to 1 within the current stage, as the protocol reports it. It is not
   * monotonic: it restarts for each stage, can jump backwards inside one, and
   * may be 0 once `status` is "synced". Don't bind a progress bar to it
   * directly; `useShieldedSync` turns it into a value that only moves forward.
   */
  progress: number;
  /** Why the scan failed. Set when `status` is "error". */
  error?: string;
};

/**
 * Proof generation has stages, not a percentage. The first proof downloads
 * the circuit files, so `loading-circuits` can take seconds.
 */
export type ProofStage = "loading-circuits" | "proving" | "verifying";

/** The proof stages, in the order they run. */
export const PROOF_STAGES = [
  "loading-circuits",
  "proving",
  "verifying",
] as const satisfies readonly ProofStage[];

/** `none`: no private account on this device. `locked`: one exists, encrypted. */
export type ShieldedAccountStatus = "none" | "locked" | "unlocked";

/** Move tokens from a public wallet into the account's private balance. */
export type ShieldDraft = {
  chainId: number;
  /** ERC-20 contract. Native currency is shielded as its wrapped token. */
  token: Address;
  /** Amount leaving the public wallet. The protocol fee comes out of it. */
  amount: bigint;
};

/** What a shield costs and yields. Known before anything is signed. */
export type ShieldQuote = {
  /** Protocol fee, taken from the amount. */
  fee: bigint;
  /** What arrives in the private balance. */
  received: bigint;
  /** Seconds the funds stay `pending` before they can be spent. */
  standby: number;
  /** Contract that must be allowed to spend the token before the shield is sent. */
  spender?: Address;
  /** True when `prepareShield` will ask the wallet for a signature. */
  needsSignature: boolean;
};

/** A transaction for the public wallet to send. */
export type PublicCall = { to: Address; data?: Hex; value?: bigint };

/** A shield, ready for the public wallet. */
export type PreparedShield = {
  /** The shield transaction. The quote's `spender` must be approved before it is sent. */
  transaction: PublicCall;
};

/** A public transaction as the private side sees it, once a scan has found it. */
export type ShieldedTransaction = {
  kind: "shield";
  token: Address;
  /** What arrived in the private balance, after the fee. */
  amount: bigint;
  /** Where those funds are now. */
  state: ShieldedBalanceState;
};

/** Move tokens from the private balance to a public address. */
export type UnshieldDraft = {
  kind: "unshield";
  chainId: number;
  /** ERC-20 contract. Native currency leaves as its wrapped token. */
  token: Address;
  /** Amount taken from the private balance. The protocol fee comes out of it. */
  amount: bigint;
  /** Public address that receives the tokens. */
  recipient: Address;
};

/** A private operation that needs a proof. Private transfers join this union later. */
export type PrivateDraft = UnshieldDraft;

/** A draft with its proof, ready to submit. */
export type ProvedOperation = {
  id: string;
  /** The exact draft the proof was made for. A changed draft needs a new proof. */
  draft: PrivateDraft;
  /** Unix ms. After this the proof must be generated again. */
  expiresAt: number;
};

/** What changed: the account, a chain's scan, or a chain's balances. */
export type ShieldedEvent = "account" | "sync" | "balances";

export interface ShieldedEngine {
  /** Names the engine, e.g. "mock" or "railgun". */
  id: string;

  account: {
    status(): ShieldedAccountStatus;
    /** Create a private account. Slow (seconds). Returns the recovery phrase once; the engine keeps it encrypted. */
    create(password: string): Promise<{ mnemonic: string }>;
    /** Restore a private account from its recovery phrase. */
    import(mnemonic: string, password: string): Promise<void>;
    /** Decrypt the account and start scanning. Rejects on a wrong password. */
    unlock(password: string): Promise<void>;
    /** Forget the decrypted account. Balances and scan state are cleared. */
    lock(): void;
    /** The account's private address, or null unless unlocked. */
    address(): string | null;
  };

  /**
   * Listen for a change. The listener gets no payload: read the new state
   * from the getters, which always agree with each other. Returns an
   * unsubscribe function. Any number of listeners per event.
   */
  subscribe(event: ShieldedEvent, listener: () => void): () => void;

  /** Scan state for a chain. Returns the same object until it changes. */
  getSync(chainId: number): ShieldedSync;

  /**
   * The account's private balances on a chain, as one complete snapshot.
   * `undefined` until the first scan finishes (and whenever the account is
   * not unlocked). Returns the same array until the balances change.
   */
  getBalances(chainId: number): readonly ShieldedTokenBalance[] | undefined;

  /**
   * What the private side knows about a public transaction, e.g. a shield.
   * `undefined` until a scan has found it: a mined transaction is not yet
   * a private balance. Changes are announced with the `balances` event.
   * Returns the same object until it changes.
   */
  getTransaction(chainId: number, hash: Hash): ShieldedTransaction | undefined;

  /**
   * Scan a chain now. Engines scan on their own after `unlock` and on an
   * interval; call this to retry a failed scan, to refresh early, or once a
   * shield is mined so the engine finds it without waiting. Resolves
   * when the scan settles. A failure is reported through `getSync`, not by
   * rejecting.
   */
  sync(chainId: number): Promise<void>;

  /**
   * Generate the missing proofs for `incomplete` funds on a chain. Resolves
   * when the attempt has finished; funds that could be proven then move to
   * `proving`. Rejects if the attempt itself failed.
   */
  retryProofs(chainId: number): Promise<void>;

  /**
   * What a shield costs and what the wallet will be asked for: fee, amount
   * received, standby period, the spender to approve, and whether a signature
   * is needed. Signs nothing and sends nothing, so the UI can lay out every
   * wallet step before the first one.
   */
  quoteShield(draft: ShieldDraft): Promise<ShieldQuote>;

  /**
   * Build the transaction that shields `draft` into this account. The
   * public wallet sends it; the engine never does.
   *
   * Some protocols derive a one-off key from a wallet signature. The engine
   * then calls `sign` with the message, at most once, and its quote says so
   * with `needsSignature`. A rejected signature must reject this promise
   * with the wallet's error.
   */
  prepareShield(
    draft: ShieldDraft,
    options: { sign(message: string): Promise<Hex> }
  ): Promise<PreparedShield>;

  /**
   * Generate the proof for a private operation. `onStage` is called as each
   * stage starts. Abort with `signal`; the promise then rejects with the
   * signal's reason.
   */
  prove(
    draft: PrivateDraft,
    options: { onStage(stage: ProofStage): void; signal?: AbortSignal }
  ): Promise<ProvedOperation>;
}
