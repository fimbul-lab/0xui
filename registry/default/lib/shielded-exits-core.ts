import { getConnection, sendTransaction, switchChain, watchConnection } from "@wagmi/core";
import type { Config } from "@wagmi/core";
import { formatUnits } from "viem";
import type { Address, Hash } from "viem";
import { createStore } from "@/lib/0xui-store";
import { errorCode, errorMessage, isUserRejection, truncateAddress } from "@/lib/0xui-utils";
import type { ErrorCode } from "@/lib/0xui-utils";
import type { ProofPhase } from "@/lib/proof-progress-core";
import type { ShieldedClient } from "@/lib/shielded-client";
import type { PreparedExit, ProofStage, ShieldedEngine, ShieldedExit } from "@/lib/shielded-engine";

/**
 * The public exits open to the account on a chain, as a store: funds that
 * can go back to the address that shielded them. Undefined until the first
 * scan finishes, and on an engine whose protocol has no such exit.
 */
export function selectShieldedExits(client: ShieldedClient, chainId: number) {
  return client.select("balances", (engine) => engine.getExits?.(chainId));
}

/** Where one exit is. `ready`: the proof is made and the wallet step waits for a click. */
export type ShieldedExitPhase = "idle" | "proving" | "ready" | "wallet" | "cancelled" | "error";

/** Why an exit stopped. `proof` says whether the proof failed, or the send. */
export type ShieldedExitProblem = { message: string; code?: ErrorCode; proof: boolean };

export type ShieldedExitState = {
  /** The connected wallet's address. */
  address: Address | undefined;
  /** The chain the wallet is on. */
  walletChainId: number | undefined;
  /** A network switch is waiting on the wallet. */
  switching: boolean;
  phase: ShieldedExitPhase;
  /** The exit in progress. Undefined while none is open. */
  exit: ShieldedExit | undefined;
  /** The proof stage that is running, or the one a failed proof stopped in. */
  stage: ProofStage | undefined;
  problem: ShieldedExitProblem | undefined;
  /** The transaction is built: `send` will open the wallet. */
  prepared: PreparedExit | undefined;
};

export type ShieldedExitFlow = {
  get(): ShieldedExitState;
  subscribe(listener: () => void): () => void;
  /** Open an exit without starting anything, e.g. to show what it means first. */
  open(exit: ShieldedExit): void;
  /** Make the proof and build the transaction for `exit`. */
  prepare(exit: ShieldedExit): void;
  /** Open the wallet for the prepared exit. One click, one prompt. */
  send(): void;
  /** Stop the proof. */
  cancel(): void;
  /** Close the exit. Nothing that was sent is undone. */
  leave(): void;
  /** Ask the wallet to move to the exit's chain. A failure leaves things as they were. */
  switchChain(): Promise<void>;
};

export type ShieldedExitFlowOptions = {
  chainId: number;
  /** Called with the exit transaction's hash once the wallet has sent it. */
  onSubmitted?: (hash: Hash, exit: ShieldedExit) => void;
};

const toError = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)));

function readWallet(config: Config) {
  const connection = getConnection(config);
  return { address: connection.address, walletChainId: connection.chainId };
}

const closed = {
  phase: "idle",
  exit: undefined,
  stage: undefined,
  problem: undefined,
  prepared: undefined,
} as const satisfies Partial<ShieldedExitState>;

/**
 * Takes one exit in two clicks after it is opened: `prepare` makes the proof
 * and builds the transaction, `send` opens the wallet. They are separate
 * because a wallet prompt has to come straight from a click, and a proof
 * takes seconds. Framework-free.
 */
export function createShieldedExitFlow(
  config: Config,
  engine: ShieldedEngine,
  { chainId, onSubmitted }: ShieldedExitFlowOptions,
): ShieldedExitFlow {
  // The proof in progress. Leaving aborts it.
  let current: AbortController | undefined;
  const store = createStore<ShieldedExitState>(
    { ...readWallet(config), switching: false, ...closed },
    (store) => {
      store.set(readWallet(config));
      const stop = watchConnection(config, { onChange: () => store.set(readWallet(config)) });
      return () => {
        stop();
        current?.abort();
      };
    },
  );

  const leave = () => {
    current?.abort();
    current = undefined;
    store.set(closed);
  };

  const prepare = async (exit: ShieldedExit) => {
    current?.abort();
    const run = new AbortController();
    current = run;
    store.set({
      exit,
      problem: undefined,
      prepared: undefined,
      stage: "loading-circuits",
      phase: "proving",
    });
    try {
      if (!engine.prepareExit) {
        throw new Error("This engine can't exit funds.");
      }
      const prepared = await engine.prepareExit(chainId, exit.id, {
        signal: run.signal,
        onStage: (stage) => {
          if (current === run) {
            store.set({ stage });
          }
        },
      });
      if (current !== run) {
        return;
      }
      store.set({ prepared, phase: "ready" });
    } catch (error_) {
      if (current !== run) {
        return;
      }
      if (run.signal.aborted) {
        return store.set({ phase: "cancelled" });
      }
      const error = toError(error_);
      store.set({
        phase: "error",
        problem: { message: error.message, code: errorCode("error", error), proof: true },
      });
    }
  };

  const send = async () => {
    const { exit, prepared, phase } = store.get();
    if (!exit || !prepared || phase === "wallet") {
      return;
    }
    store.set({ problem: undefined, phase: "wallet" });
    try {
      const hash = await sendTransaction(config, { chainId, ...prepared.transaction });
      leave();
      onSubmitted?.(hash, exit);
    } catch (error_) {
      const error = toError(error_);
      if (isUserRejection(error)) {
        return store.set({ phase: "cancelled" });
      }
      store.set({
        phase: "error",
        problem: {
          message: errorMessage(error),
          code: errorCode("error", error),
          proof: false,
        },
      });
    }
  };

  return {
    get: store.get,
    subscribe: store.subscribe,
    open(exit) {
      leave();
      store.set({ exit });
    },
    prepare: (exit) => void prepare(exit),
    send: () => void send(),
    cancel: () => current?.abort(),
    leave,
    async switchChain() {
      store.set({ switching: true });
      try {
        await switchChain(config, { chainId });
      } catch {
        // A rejected or failed switch leaves the button offering it again.
      } finally {
        store.set({ switching: false });
      }
    },
  };
}

/**
 * Why the wallet can't send the exit yet, or undefined when it can. An exit
 * only works from the address that shielded the funds.
 */
export function shieldedExitBlocker({
  address,
  depositor,
  walletChainId,
  chainId,
  chainName = "the right network",
}: {
  /** Connected wallet address. */
  address: Address | undefined;
  depositor: Address | undefined;
  walletChainId: number | undefined;
  chainId: number;
  chainName?: string;
}): { label: string; action?: "connect" | "switch-chain" } | undefined {
  if (!address) {
    return { label: "Connect wallet", action: "connect" };
  }
  if (depositor && address.toLowerCase() !== depositor.toLowerCase()) {
    return { label: `Switch wallet to ${truncateAddress(depositor)}` };
  }
  if (walletChainId !== chainId) {
    return { label: `Switch to ${chainName}`, action: "switch-chain" };
  }
  return undefined;
}

/** The open exit's button label, and what pressing it does, if anything. */
export type ShieldedExitAction = {
  label: string;
  action?: "connect" | "switch-chain" | "prepare" | "send";
};

/**
 * The open exit's button: its label and what a click does. A blocker comes
 * first, then where the exit is.
 */
export function shieldedExitAction({
  blocker,
  phase,
  prepared,
  switching,
}: {
  blocker: ReturnType<typeof shieldedExitBlocker>;
  phase: ShieldedExitPhase;
  prepared: boolean;
  switching: boolean;
}): ShieldedExitAction {
  if (blocker) {
    if (blocker.action === "switch-chain" && switching) {
      return { label: "Switching network…" };
    }
    return blocker;
  }
  if (phase === "proving") {
    return { label: "Preparing exit…" };
  }
  if (phase === "wallet") {
    return { label: "Confirm in wallet…" };
  }
  if (prepared) {
    return { label: "Send exit from wallet", action: "send" };
  }
  return { label: phase === "idle" ? "Prepare exit" : "Try again", action: "prepare" };
}

/** The exit's phase as ProofProgress shows it. */
export function exitProofPhase({
  phase,
  stage,
  problem,
  prepared,
}: Pick<ShieldedExitState, "phase" | "stage" | "problem"> & { prepared: boolean }): ProofPhase {
  if (problem?.proof) {
    return "error";
  }
  if (phase === "cancelled" && !prepared) {
    return "cancelled";
  }
  if (prepared) {
    return "done";
  }
  if (phase === "proving") {
    return stage ?? "loading-circuits";
  }
  return phase === "idle" ? "idle" : "done";
}

/**
 * What a person confirms before an agent's press opens the wallet for an
 * exit: the amount, where it goes, and that it is public. Set as the send
 * button's `data-agent-confirm`.
 */
export function shieldedExitConfirmText({
  exit,
  token,
}: {
  exit: Pick<ShieldedExit, "amount" | "depositor">;
  token: { symbol: string; decimals: number } | undefined;
}) {
  const amount = token
    ? `${formatUnits(exit.amount, token.decimals)} ${token.symbol}`
    : "These private funds";
  const to = exit.depositor ?? "the address that shielded them";
  return `Sends ${amount} from your private balance back to ${to} in public. Anyone can see it, and it can't be undone.`;
}
