import { getPublicClient, type Config } from "@wagmi/core";
import { getTransactionConfirmationsQueryOptions, hashFn } from "@wagmi/core/query";
import type { Hash, TransactionReceipt } from "viem";

export type TxStatusPhase = "pending" | "confirming" | "confirmed" | "reverted" | "error";

export type StepState = "done" | "active" | "failed" | "todo";

export type TransactionStep = {
  id: "submitted" | "included" | "confirmations";
  label: string;
  state: StepState;
};

type TxTarget = { hash: Hash | undefined; chainId: number | undefined };

/**
 * Wait for a transaction to be mined. Unlike wagmi's waitForTransactionReceipt,
 * a reverted transaction resolves with its receipt (`status: "reverted"`)
 * instead of throwing, so the UI can show it.
 */
export function waitForMinedReceipt(config: Config, { hash, chainId }: { hash: Hash; chainId?: number }) {
  const client = getPublicClient(config, { chainId });
  if (!client) return Promise.reject(new Error(`Chain ${chainId} is not in the wagmi config.`));
  return client.waitForTransactionReceipt({ hash });
}

/** Query options for the mined receipt of `hash`. Pass them to TanStack's `useQuery` (or Vue/Svelte's). */
export function minedReceiptQueryOptions(config: Config, { hash, chainId }: TxTarget) {
  return {
    queryKey: ["0xui", "mined-receipt", chainId, hash] as const,
    queryFn: () => waitForMinedReceipt(config, { hash: hash!, chainId }),
    enabled: Boolean(hash && getPublicClient(config, { chainId })),
    staleTime: Infinity,
    retry: false,
  };
}

/** Query options for a live confirmation count, polled every 4s while `enabled`. */
export function transactionConfirmationsQueryOptions(
  config: Config,
  { hash, chainId, enabled = true }: TxTarget & { enabled?: boolean },
) {
  return {
    ...getTransactionConfirmationsQueryOptions(config, {
      hash,
      chainId,
      query: { enabled, refetchInterval: 4_000 },
    }),
    queryKeyHashFn: hashFn,
  };
}

/** Where a transaction stands, from its receipt and confirmation count. */
export function transactionStatus({
  receipt,
  failed,
  count,
  required = 1,
}: {
  receipt: TransactionReceipt | undefined;
  /** The receipt lookup failed. */
  failed: boolean;
  /** Confirmations so far, when more than one is required. */
  count: bigint | null | undefined;
  required?: number;
}) {
  const confirmations = receipt ? (required > 1 ? Number(count ?? 1n) : 1) : 0;
  const phase: TxStatusPhase = failed
    ? "error"
    : !receipt
      ? "pending"
      : receipt.status === "reverted"
        ? "reverted"
        : confirmations >= required
          ? "confirmed"
          : "confirming";
  return { phase, confirmations: Math.min(confirmations, required), required };
}

/** The step list for a status card: submitted, included in a block, then confirmations when more than one is required. */
export function transactionSteps({
  phase,
  receipt,
  confirmations,
  required,
}: ReturnType<typeof transactionStatus> & { receipt: TransactionReceipt | undefined }) {
  const steps: TransactionStep[] = [
    { id: "submitted", label: "Submitted", state: "done" },
    {
      id: "included",
      label: receipt
        ? `Included in block ${receipt.blockNumber.toLocaleString()}`
        : "Waiting to be included in a block",
      state: receipt
        ? receipt.status === "reverted"
          ? "failed"
          : "done"
        : phase === "error"
          ? "failed"
          : "active",
    },
  ];
  if (required > 1 && phase !== "reverted") {
    steps.push({
      id: "confirmations",
      label: `${confirmations} of ${required} confirmations`,
      state: phase === "confirmed" ? "done" : phase === "confirming" ? "active" : "todo",
    });
  }
  return steps;
}
