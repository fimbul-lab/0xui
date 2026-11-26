import {
  getCapabilities,
  getConnection,
  getPublicClient,
  sendCalls,
  sendTransaction,
  switchChain,
  waitForCallsStatus,
  watchConnection,
} from "@wagmi/core";
import type { Config } from "@wagmi/core";
import type { Address, Chain, Hex } from "viem";
import { createStore } from "@/lib/0xui-store";
import { isUserRejection } from "@/lib/0xui-utils";

export type BatchCall = {
  to: Address;
  data?: Hex;
  value?: bigint;
  /** Step name shown in the list, e.g. "Approve USDC". */
  label?: string;
};

/**
 * "atomic" sends every call in one wallet prompt (EIP-5792). "sequential"
 * sends them one by one, waiting for each to be mined. "auto" picks atomic
 * when the wallet reports support for it on the chain.
 */
export type BatchMode = "auto" | "atomic" | "sequential";

export type BatchPhase =
  | "idle"
  | "switching"
  | "confirming"
  | "pending"
  | "success"
  | "reverted"
  | "cancelled"
  | "error";

export type StepState = "todo" | "active" | "done" | "failed";

export type BatchTransactionState = {
  phase: BatchPhase;
  /** Index of the call being sent. Equals the number of calls once all are done. */
  step: number;
  /** Why the last run failed. A rejection in the wallet shows as phase `cancelled`. */
  error: Error | undefined;
  /** The calls go out in one wallet prompt. */
  atomic: boolean;
  isConnected: boolean;
  /** Connected, but to another chain than the calls are for. */
  wrongChain: boolean;
  /** The chain the calls are for, when the config has it. */
  targetChain: Chain | undefined;
};

export type BatchTransaction = {
  get(): BatchTransactionState;
  subscribe(listener: () => void): () => void;
  /** Send the calls, atomically or one by one. Resolves once they settle or fail. */
  execute(calls: ReadonlyArray<BatchCall>): Promise<void>;
  /** Ask the wallet to switch to the calls' chain. */
  switchToTarget(): Promise<void>;
  /** Back to idle. */
  reset(): void;
};

/** "Approve USDC, then Swap": the calls in order, by label. */
export function describeBatchCalls(calls: ReadonlyArray<Pick<BatchCall, "label">>) {
  return calls.map((call, i) => call.label ?? `Step ${i + 1}`).join(", then ");
}

/** Whether a wallet's EIP-5792 capabilities for a chain allow atomic batches. */
export function supportsAtomic(capabilities: unknown) {
  const status = (capabilities as { atomic?: { status?: string } } | undefined)?.atomic?.status;
  return status === "supported" || status === "ready";
}

/** Where step `index` stands in a run. */
export function batchStepState(
  { phase, step }: Pick<BatchTransactionState, "phase" | "step">,
  index: number,
): StepState {
  if (phase === "success" || index < step) {
    return "done";
  }
  if (index > step) {
    return "todo";
  }
  if (phase === "reverted" || phase === "error") {
    return "failed";
  }
  if (phase === "confirming" || phase === "pending") {
    return "active";
  }
  return "todo";
}

/**
 * Sends a list of calls on one chain: in a single wallet prompt when the
 * wallet supports atomic batches (EIP-5792), else one transaction at a time.
 * Framework-free.
 */
export function createBatchTransaction(
  config: Config,
  { chainId, mode = "auto" }: { chainId: number; mode?: BatchMode },
): BatchTransaction {
  const targetChain = config.chains.find((c) => c.id === chainId);
  let capabilityCheck = 0;

  const readConnection = () => {
    const connection = getConnection(config);
    const isConnected = connection.status === "connected";
    return { isConnected, wrongChain: isConnected && connection.chainId !== chainId };
  };

  const checkCapabilities = async () => {
    if (mode !== "auto") {
      return;
    }
    const check = ++capabilityCheck;
    if (!readConnection().isConnected) {
      return store.set({ atomic: false });
    }
    let atomic = false;
    try {
      atomic = supportsAtomic(await getCapabilities(config, { chainId }));
    } catch {
      // Wallets without EIP-5792 throw: send one by one.
    }
    if (check === capabilityCheck) {
      store.set({ atomic });
    }
  };

  const store = createStore<BatchTransactionState>(
    {
      phase: "idle",
      step: 0,
      error: undefined,
      atomic: mode === "atomic",
      targetChain,
      ...readConnection(),
    },
    (store) => {
      let address = getConnection(config).address;
      store.set(readConnection());
      void checkCapabilities();
      const stop = watchConnection(config, {
        onChange(connection) {
          store.set(readConnection());
          if (connection.address !== address) {
            address = connection.address;
            void checkCapabilities();
          }
        },
      });
      return () => {
        capabilityCheck++;
        stop();
      };
    },
  );

  const fail = (e: unknown) => {
    const error = e instanceof Error ? e : new Error(String(e));
    store.set({ error, phase: isUserRejection(error) ? "cancelled" : "error" });
  };

  return {
    get: store.get,
    subscribe: store.subscribe,
    async execute(calls) {
      store.set({ error: undefined, step: 0 });
      try {
        if (store.get().atomic) {
          store.set({ phase: "confirming" });
          const { id } = await sendCalls(config, {
            chainId,
            calls: calls.map(({ to, data, value }) => ({ to, data, value })),
          });
          store.set({ phase: "pending" });
          const result = await waitForCallsStatus(config, { id });
          store.set({
            step: calls.length,
            phase: result.status === "success" ? "success" : "reverted",
          });
          return;
        }
        const client = getPublicClient(config, { chainId });
        for (const [i, call] of calls.entries()) {
          store.set({ step: i, phase: "confirming" });
          const hash = await sendTransaction(config, {
            chainId,
            to: call.to,
            data: call.data,
            value: call.value,
          });
          store.set({ phase: "pending" });
          // viem resolves a reverted receipt; wagmi's action would throw instead.
          if (!client) {
            throw new Error(`Chain ${chainId} is not in the wagmi config.`);
          }
          const receipt = await client.waitForTransactionReceipt({ hash });
          if (receipt.status === "reverted") {
            return store.set({ phase: "reverted" });
          }
        }
        store.set({ step: calls.length, phase: "success" });
      } catch (error) {
        fail(error);
      }
    },
    async switchToTarget() {
      store.set({ error: undefined, phase: "switching" });
      try {
        await switchChain(config, { chainId });
        store.set({ phase: "idle", ...readConnection() });
      } catch (error) {
        fail(error);
      }
    },
    reset() {
      store.set({ phase: "idle", step: 0, error: undefined });
    },
  };
}
