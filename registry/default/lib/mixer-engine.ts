// Docs: https://0xui.io/components/mixer-engine.md
import { formatUnits, type Address, type Hash, type Hex } from "viem";
import type { ProofStage } from "@/lib/shielded-engine";

/**
 * One pool of a note-based mixer. Every deposit into it is the same amount,
 * which is what makes them indistinguishable.
 */
export type MixerPool = {
  chainId: number;
  /** The pool contract. */
  address: Address;
  /** ERC-20 the pool holds. Leave undefined for the chain's native token. */
  token?: Address;
  symbol: string;
  decimals: number;
  /** The one amount this pool takes, in the token's smallest unit. */
  denomination: bigint;
};

/**
 * A note, read. The note text itself is the money: whoever has it can
 * withdraw the deposit, and nothing can recover it once lost. Never store
 * it, log it, or put it in the DOM outside the field the user reads it from.
 */
export type MixerNote = {
  /** The secret text to back up. */
  note: string;
  /** The pool the note belongs to. */
  pool: MixerPool;
  /** What the deposit publishes. Safe to show and store. */
  commitment: Hex;
};

/** A call for the public wallet to send. */
export type MixerCall = { to: Address; data: Hex; value?: bigint };

/**
 * `missing`: no deposit with this note is on chain (not sent yet, not mined
 * yet, or a note for another pool). `deposited`: it can be withdrawn.
 * `withdrawn`: it was, and the note is worth nothing now.
 */
export type MixerDepositState = "missing" | "deposited" | "withdrawn";

export type MixerDeposit = {
  state: MixerDepositState;
  /** When the deposit was mined, in seconds. */
  timestamp?: number;
  /**
   * Deposits made into the pool after this one. The crowd the withdrawal
   * hides in: with few, a withdrawal is easy to link to its deposit.
   */
  depositsSince?: number;
};

/**
 * Who sends the withdrawal. `wallet`: the connected wallet, which pays the
 * gas in public and gets nothing taken from the amount. `relayer`: a
 * relayer sends it and keeps a fee, so the recipient needs no gas and no
 * wallet shows up next to it.
 */
export type MixerWithdrawVia = "wallet" | "relayer";

export type MixerWithdrawDraft = {
  note: string;
  /** Public address that receives the funds. */
  recipient: Address;
  via: MixerWithdrawVia;
};

/** What a withdrawal pays out. `fee + received` is the pool's denomination. */
export type MixerQuote = { fee: bigint; received: bigint };

/**
 * `syncing`: the pool's deposit history is being read, which the proof is
 * built from. Then the proof stages.
 */
export type MixerStage = "syncing" | ProofStage;

/** The stages of a withdrawal proof, in the order they run. */
export const MIXER_STAGES = [
  "syncing",
  "loading-circuits",
  "proving",
  "verifying",
] as const satisfies readonly MixerStage[];

/** A withdrawal with its proof made. The proof is bound to the recipient and the fee. */
export type MixerWithdrawal = {
  pool: MixerPool;
  recipient: Address;
  via: MixerWithdrawVia;
  /** The fee the proof commits to. */
  quote: MixerQuote;
  /** The withdraw call. With `via: "wallet"`, what the wallet sends. */
  transaction: MixerCall;
  /** Engine-private handle. */
  id: string;
};

/**
 * A note-based mixer (Tornado-style pools) behind one interface. There is
 * no account and no balance: a deposit makes a note, and the note withdraws
 * it. The engine never keeps a note.
 */
export interface MixerEngine {
  /** Stable name, e.g. "tornado". Used in query keys. */
  readonly id: string;
  /** The pools this engine knows. */
  readonly pools: readonly MixerPool[];

  /** Make a new note for `pool`, from fresh randomness. Sends nothing. */
  createNote(pool: MixerPool): Promise<MixerNote>;

  /**
   * Read pasted text as a note. Rejects with a message fit to show when it
   * is not a note, or is one for a pool this engine doesn't know.
   */
  parseNote(text: string): Promise<MixerNote>;

  /** The deposit call for a note. ERC-20 pools need the pool approved for the denomination first. */
  prepareDeposit(note: string): Promise<MixerCall>;

  /** Where the note's deposit is, read from the chain. */
  getDeposit(note: string, options?: { signal?: AbortSignal }): Promise<MixerDeposit>;

  /**
   * What a withdrawal from `pool` pays out right now. Rejects for
   * `via: "relayer"` on an engine with no relayer.
   */
  quote(pool: MixerPool, via: MixerWithdrawVia): Promise<MixerQuote>;

  /** Whether withdrawals can go through a relayer. */
  readonly relays: boolean;

  /**
   * Read the pool's deposits and make the withdrawal proof. Slow: seconds
   * to minutes. Reports each stage as it starts. Rejects when the note has
   * no deposit or was already withdrawn.
   */
  prove(
    draft: MixerWithdrawDraft,
    options: { onStage(stage: MixerStage): void; signal?: AbortSignal },
  ): Promise<MixerWithdrawal>;

  /** Hand a `via: "relayer"` withdrawal to the relayer. Resolves once it is broadcast. */
  relay(withdrawal: MixerWithdrawal): Promise<{ hash: Hash }>;
}

/** A pool's amount as text, like "0.1 ETH". */
export function mixerPoolLabel(pool: Pick<MixerPool, "denomination" | "decimals" | "symbol">) {
  return `${formatUnits(pool.denomination, pool.decimals)} ${pool.symbol}`;
}

/** Whether two pools are the same contract on the same chain. */
export function sameMixerPool(
  a: Pick<MixerPool, "chainId" | "address">,
  b: Pick<MixerPool, "chainId" | "address">,
) {
  return a.chainId === b.chainId && a.address.toLowerCase() === b.address.toLowerCase();
}
