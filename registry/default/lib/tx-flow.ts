import {
  getConnection,
  getTransactionConfirmations,
  sendTransaction,
  switchChain,
  watchConnection,
  writeContract,
} from "@wagmi/core";
import type { Config, SendTransactionParameters, WriteContractParameters } from "@wagmi/core";
import { callQueryOptions, hashFn, simulateContractQueryOptions } from "@wagmi/core/query";
import { BaseError, ContractFunctionRevertedError } from "viem";
import type { Address, Chain, Hash, TransactionReceipt } from "viem";
import { createStore } from "@/lib/0xui-store";
import { isUserRejection } from "@/lib/0xui-utils";
import { waitForMinedReceipt } from "@/lib/transaction-status-core";

export type TxPhase =
  | "idle"
  | "switching"
  | "confirming"
  | "pending"
  | "success"
  | "reverted"
  | "cancelled"
  | "error";

/** Arguments for `writeContract`: `{ address, abi, functionName, args, value? }`. */
export type ContractRequest = WriteContractParameters;

/** Arguments for `sendTransaction`: `{ to, value?, data? }`. */
export type TransactionRequest = SendTransactionParameters;

export type TransactionFlowOptions = {
  /** Chain the transaction must run on. Defaults to the current chain. */
  chainId?: number;
  /** Confirmations to wait for before success. */
  confirmations?: number;
  /** Called once the wallet returns a transaction hash. */
  onSubmitted?: (hash: Hash) => void;
  /** Called when the transaction is mined successfully. */
  onSuccess?: (receipt: TransactionReceipt) => void;
  /** Called on failure, including a reverted transaction. Not called when the user cancels. */
  onError?: (error: Error) => void;
};

export type TransactionFlowState = {
  phase: TxPhase;
  /** Set once the wallet returns it. */
  hash: Hash | undefined;
  /** Set once the transaction is mined, successful or reverted. */
  receipt: TransactionReceipt | undefined;
  /** Why the last attempt failed or was cancelled. */
  error: Error | undefined;
  isConnected: boolean;
  /** The wallet is on another chain than `targetChain`. */
  wrongChain: boolean;
  /** The chain the transaction runs on, when the config has it. */
  targetChain: Chain | undefined;
};

export type TransactionFlow = {
  get(): TransactionFlowState;
  subscribe(listener: () => void): () => void;
  /** Ask the wallet to send, then follow the transaction until it settles. Never throws. */
  execute(
    request: { contract: ContractRequest } | { transaction: TransactionRequest },
  ): Promise<void>;
  /** Ask the wallet to switch to the target chain. Never throws. */
  switchToTarget(): Promise<void>;
  /** Back to idle. A transaction still in flight no longer updates the state or fires callbacks. */
  reset(): void;
};

const toError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function readTarget(config: Config, chainId: number | undefined) {
  const connection = getConnection(config);
  const targetChainId = chainId ?? connection.chainId;
  return {
    isConnected: connection.status === "connected",
    targetChain: config.chains.find((c) => c.id === targetChainId),
    wrongChain:
      connection.status === "connected" &&
      targetChainId !== undefined &&
      connection.chainId !== targetChainId,
  };
}

/**
 * The transaction lifecycle as one phase: switching network, waiting for the
 * wallet, pending on-chain, then success, reverted, cancelled or error.
 * Framework-free.
 */
export function createTransactionFlow(
  config: Config,
  { chainId, confirmations = 1, onSubmitted, onSuccess, onError }: TransactionFlowOptions = {},
): TransactionFlow {
  const store = createStore<TransactionFlowState>(
    {
      phase: "idle",
      hash: undefined,
      receipt: undefined,
      error: undefined,
      ...readTarget(config, chainId),
    },
    (store) => {
      store.set(readTarget(config, chainId));
      return watchConnection(config, { onChange: () => store.set(readTarget(config, chainId)) });
    },
  );
  // Bumped by every action, so a stale one can't overwrite a newer one's state.
  let run = 0;

  const fail = (e: unknown) => {
    const error = toError(e);
    if (isUserRejection(error)) {
      store.set({ phase: "cancelled", error });
    } else {
      store.set({ phase: "error", error });
      onError?.(error);
    }
  };

  const waitForConfirmations = async (hash: Hash, target: number | undefined, id: number) => {
    while (confirmations > 1 && id === run) {
      try {
        const count = await getTransactionConfirmations(config, { hash, chainId: target });
        if (count >= BigInt(confirmations)) {
          return;
        }
      } catch {
        // A failed poll isn't a failed transaction: try again next round.
      }
      await sleep(4000);
    }
  };

  return {
    get: store.get,
    subscribe: store.subscribe,
    async execute(request) {
      const id = ++run;
      const target = chainId ?? getConnection(config).chainId;
      store.set({ phase: "confirming", hash: undefined, receipt: undefined, error: undefined });
      let hash: Hash;
      try {
        // Pin the chain so the wallet can't send on a different one.
        hash =
          "contract" in request
            ? await writeContract(config, {
                chainId: target,
                ...request.contract,
              })
            : await sendTransaction(config, {
                chainId: target,
                ...request.transaction,
              });
      } catch (error) {
        if (id === run) {
          fail(error);
        }
        return;
      }
      if (id !== run) {
        return;
      }
      store.set({ phase: "pending", hash });
      onSubmitted?.(hash);

      try {
        const receipt = await waitForMinedReceipt(config, { hash, chainId: target });
        if (id !== run) {
          return;
        }
        store.set({ receipt });
        if (receipt.status === "reverted") {
          store.set({ phase: "reverted" });
          onError?.(new Error("Transaction reverted"));
          return;
        }
        await waitForConfirmations(hash, target, id);
        if (id !== run) {
          return;
        }
        store.set({ phase: "success" });
        onSuccess?.(receipt);
      } catch (error_) {
        if (id !== run) {
          return;
        }
        const error = toError(error_);
        store.set({ phase: "error", error });
        onError?.(error);
      }
    },
    async switchToTarget() {
      const target = chainId ?? getConnection(config).chainId;
      if (target === undefined) {
        return;
      }
      const id = ++run;
      store.set({ phase: "switching", error: undefined });
      try {
        await switchChain(config, { chainId: target });
        if (id === run) {
          store.set({ phase: "idle", ...readTarget(config, chainId) });
        }
      } catch (error) {
        if (id === run) {
          fail(error);
        }
      }
    },
    reset() {
      run++;
      store.set({ phase: "idle", hash: undefined, receipt: undefined, error: undefined });
    },
  };
}

/** Why a call failed, in the contract's own words when it gave a revert reason. */
export function revertReason(error: unknown) {
  if (!(error instanceof BaseError)) {
    return error instanceof Error ? error.message : "Something went wrong.";
  }
  const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
  if (revert instanceof ContractFunctionRevertedError) {
    return revert.reason ?? revert.data?.errorName ?? revert.shortMessage;
  }
  return error.shortMessage;
}

export type SimulationStatus = "idle" | "checking" | "ok" | "failed";

export type TransactionSimulationParameters = {
  /** Contract call to simulate. Pass this or `transaction`. */
  contract?: ContractRequest;
  /** Plain transaction to simulate. Pass this or `contract`. */
  transaction?: TransactionRequest;
  /** Chain to simulate on. */
  chainId?: number;
  /** The account that would send it. Nothing runs without one. */
  account?: Address;
  /** Set false to skip the simulation. */
  enabled?: boolean;
};

/**
 * Query options that dry-run a transaction with `eth_call`, so a revert shows
 * up before the wallet opens. Pass them to TanStack's `useQuery`.
 */
export function transactionSimulationQueryOptions(
  config: Config,
  { contract, transaction, chainId, account, enabled = true }: TransactionSimulationParameters,
) {
  const on = enabled && Boolean(account);
  const options = contract
    ? simulateContractQueryOptions(config, {
        ...contract,
        chainId,
        account,
        query: { enabled: on, retry: false },
      } as never)
    : {
        ...callQueryOptions(config, {
          ...transaction,
          chainId,
          account,
          query: { retry: false },
        } as never),
        enabled: on && Boolean(transaction),
      };
  // Query keys hold bigints (values, amounts), which TanStack's default hash can't serialize.
  return { ...(options as ReturnType<typeof callQueryOptions>), queryKeyHashFn: hashFn };
}

/** The simulation's status from its query. `idle` until there is an account and a request. */
export function simulationStatus({
  active,
  isError,
  isPending,
}: {
  /** The simulation is enabled and has an account and a request. */
  active: boolean;
  isError: boolean;
  isPending: boolean;
}): SimulationStatus {
  return !active ? "idle" : isError ? "failed" : isPending ? "checking" : "ok";
}
