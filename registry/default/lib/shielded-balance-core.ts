import type { Address } from "viem";
import { createStore } from "@/lib/0xui-store";
import {
  SHIELDED_BALANCE_STATES,
  type ShieldedBalanceState,
  type ShieldedEngine,
  type ShieldedTokenBalance,
} from "@/lib/shielded-engine";

export type ShieldedBalancePhase = "idle" | "loading" | "ready" | "error";

/** Where a "retry proofs" attempt is. `retried` means it finished; the funds may still be incomplete. */
export type ShieldedRetryPhase = "idle" | "retrying" | "retried" | "error";

export type ShieldedBalancesState = {
  phase: ShieldedBalancePhase;
  chainId: number;
  /** One entry per token held. Undefined until the first scan finishes. */
  balances: readonly ShieldedTokenBalance[] | undefined;
  /** A scan is running and the balances shown may be about to change. */
  isUpdating: boolean;
  retryPhase: ShieldedRetryPhase;
  retryError: Error | undefined;
};

export type ShieldedBalances = {
  get(): ShieldedBalancesState;
  subscribe(listener: () => void): () => void;
  /** Generate the missing proofs for incomplete funds. */
  retryProofs(): Promise<void>;
};

/** The balances before the browser has read them, e.g. in server HTML. */
export const serverBalances = (chainId: number): ShieldedBalancesState => ({
  phase: "idle",
  chainId,
  balances: undefined,
  isUpdating: false,
  retryPhase: "idle",
  retryError: undefined,
});

function readBalances(engine: ShieldedEngine, chainId: number) {
  const snapshot = engine.getBalances(chainId);
  const syncStatus = engine.getSync(chainId).status;
  const phase: ShieldedBalancePhase =
    engine.account.status() !== "unlocked"
      ? "idle"
      : snapshot
        ? "ready"
        : syncStatus === "error"
          ? "error"
          : "loading";
  return {
    phase,
    balances: phase === "ready" ? snapshot : undefined,
    isUpdating: phase === "ready" && syncStatus === "syncing",
  };
}

/**
 * Every token in the private balance on a chain, each split by state, plus
 * the "retry proofs" action for incomplete funds. Balances come from the
 * engine as one snapshot, so the states of a token always add up. Framework-free.
 */
export function createShieldedBalances(engine: ShieldedEngine, chainId: number): ShieldedBalances {
  const store = createStore<ShieldedBalancesState>(
    { ...serverBalances(chainId), ...readBalances(engine, chainId) },
    (store) => {
      const update = () => store.set(readBalances(engine, chainId));
      update();
      const stops = (["account", "balances", "sync"] as const).map((event) =>
        engine.subscribe(event, update)
      );
      return () => stops.forEach((stop) => stop());
    }
  );

  return {
    get: store.get,
    subscribe: store.subscribe,
    async retryProofs() {
      store.set({ retryPhase: "retrying", retryError: undefined });
      try {
        await engine.retryProofs(chainId);
        store.set({ retryPhase: "retried" });
      } catch (error) {
        store.set({
          retryPhase: "error",
          retryError: error instanceof Error ? error : new Error(String(error)),
        });
      }
    },
  };
}

const NO_FUNDS: ShieldedTokenBalance["amounts"] = {
  spendable: 0n,
  pending: 0n,
  proving: 0n,
  incomplete: 0n,
  restricted: 0n,
};

/** One token's amounts from a balances snapshot, any address casing. A token not held is all zeros. */
export function tokenAmounts(balances: readonly ShieldedTokenBalance[], token: Address) {
  return (
    balances.find((b) => b.token.toLowerCase() === token.toLowerCase())?.amounts ?? NO_FUNDS
  );
}

/** Sum of a token's private balance across every state. */
export function totalShielded(amounts: ShieldedTokenBalance["amounts"]) {
  return SHIELDED_BALANCE_STATES.reduce((sum, state) => sum + amounts[state], 0n);
}

/** Default label and explanation for each balance state. */
export const shieldedBalanceMeta: Record<
  ShieldedBalanceState,
  { label: string; description: string }
> = {
  spendable: { label: "Spendable", description: "Ready to send or unshield." },
  pending: {
    label: "Pending",
    description: "Recently shielded. Spendable after the waiting period.",
  },
  proving: {
    label: "Proving",
    description: "Proofs for these funds are being checked.",
  },
  incomplete: {
    label: "Incomplete",
    description: "A proof is missing, so these funds can't be spent yet.",
  },
  restricted: {
    label: "Restricted",
    description: "Can't be spent privately. These funds can only go back to the address they came from.",
  },
};
