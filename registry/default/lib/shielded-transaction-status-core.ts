import type { Config } from "@wagmi/core";
import { getBlockQueryOptions, hashFn } from "@wagmi/core/query";
import type { TransactionReceipt } from "viem";
import type { ShieldedTransaction } from "@/lib/shielded-engine";

export type ShieldedTxStatusPhase =
  /** Sent, not mined yet. */
  | "pending"
  /** Mined. The private account has not found it yet. */
  | "confirmed"
  /** In the private balance, waiting out the standby period. */
  | "standby"
  | "spendable"
  | "restricted"
  | "reverted"
  | "error";

/** "about 2 min", "45 s", or undefined once there is nothing left to wait for. */
export function formatWait(seconds: number) {
  if (seconds <= 0) return undefined;
  if (seconds >= 5_400) return `about ${Math.round(seconds / 3_600)} hours`;
  if (seconds >= 3_000) return "about 1 hour";
  if (seconds >= 90) return `about ${Math.ceil(seconds / 60)} min`;
  return `${seconds} s`;
}

/**
 * Where a shield is. What the private side says wins: it is the balance that
 * matters, so a mined transaction alone is only "confirmed".
 */
export function shieldedTxPhase({
  transaction,
  receipt,
  receiptFailed,
}: {
  /** What the engine's scan found, if anything. */
  transaction: ShieldedTransaction | undefined;
  /** The public receipt, once mined. */
  receipt: Pick<TransactionReceipt, "status"> | undefined;
  /** Waiting for the receipt failed. */
  receiptFailed: boolean;
}): ShieldedTxStatusPhase {
  if (transaction) {
    return transaction.state === "spendable"
      ? "spendable"
      : transaction.state === "restricted"
        ? "restricted"
        : "standby";
  }
  if (receiptFailed) return "error";
  if (!receipt) return "pending";
  return receipt.status === "reverted" ? "reverted" : "confirmed";
}

/**
 * The block a shield was mined in, for the start of its standby period.
 * Only fetched when there is a standby to count down.
 */
export function standbyBlockQueryOptions(
  config: Config,
  {
    chainId,
    blockNumber,
    standby,
  }: { chainId: number; blockNumber: bigint | undefined; standby: number | undefined },
) {
  return {
    ...getBlockQueryOptions(config, {
      chainId,
      blockNumber,
      query: { enabled: blockNumber !== undefined && standby !== undefined, staleTime: Infinity },
    }),
    queryKeyHashFn: hashFn,
  };
}

/** Unix ms when the standby period ends, from the block's timestamp (seconds). */
export function spendableAt(blockTimestamp: bigint | undefined, standby: number | undefined) {
  return blockTimestamp !== undefined && standby !== undefined
    ? (Number(blockTimestamp) + standby) * 1_000
    : undefined;
}

/** What a shield is waiting for, as the end of a sentence: "waiting for a block". */
export function shieldedStatusText(phase: ShieldedTxStatusPhase, secondsLeft?: number) {
  if (phase === "pending") return "waiting for a block";
  if (phase === "confirmed") return "updating private balance";
  if (phase === "spendable") return "spendable";
  if (phase === "restricted") return "restricted, it can only go back where it came from";
  if (phase === "reverted") return "reverted, nothing was shielded";
  if (phase === "error") return "couldn't be tracked";
  if (secondsLeft === undefined) return "in its waiting period";
  const wait = formatWait(secondsLeft);
  return wait ? `spendable in ${wait}` : "spendable any moment now";
}

/** Default heading for each phase. */
export const shieldedTxHeadings: Record<ShieldedTxStatusPhase, string> = {
  pending: "Shield pending",
  confirmed: "Confirmed, updating private balance",
  standby: "Shielded, not spendable yet",
  spendable: "Shielded and spendable",
  restricted: "Shielded, but restricted",
  reverted: "Shield reverted",
  error: "Couldn't track shield",
};

export type ShieldedTxStepState = "done" | "active" | "failed" | "todo";

export type ShieldedTxStep = {
  id: "submitted" | "included" | "found" | "spendable";
  label: string;
  state: ShieldedTxStepState;
};

/**
 * The steps from the public transaction to a spendable private balance:
 * submitted, included in a block, found by the private account, then the
 * standby period. A reverted or lost transaction stops after the block.
 */
export function shieldedTxSteps({
  phase,
  blockNumber,
  found,
  secondsLeft,
}: {
  phase: ShieldedTxStatusPhase;
  /** The block it was mined in, once the receipt is known. */
  blockNumber: bigint | undefined;
  /** The engine's scan found it. */
  found: boolean;
  /** Seconds of standby left, when known. */
  secondsLeft: number | undefined;
}): Array<ShieldedTxStep> {
  const failed = phase === "reverted" || phase === "error";
  const steps: Array<ShieldedTxStep> = [
    { id: "submitted", label: "Submitted", state: "done" },
    {
      id: "included",
      label:
        blockNumber !== undefined
          ? `Included in block ${blockNumber.toLocaleString()}`
          : found
            ? "Included in a block"
            : "Waiting to be included in a block",
      state: failed ? "failed" : blockNumber !== undefined || found ? "done" : "active",
    },
  ];
  if (failed) return steps;

  const wait = secondsLeft === undefined ? undefined : formatWait(secondsLeft);
  steps.push(
    {
      id: "found",
      label: found ? "Added to your private balance" : "Updating your private balance",
      state: found ? "done" : phase === "confirmed" ? "active" : "todo",
    },
    {
      id: "spendable",
      label:
        phase === "spendable"
          ? "Spendable"
          : phase === "restricted"
            ? "Not spendable: restricted"
            : phase !== "standby"
              ? "Waiting period before it can be spent"
              : secondsLeft === undefined
                ? "Waiting period"
                : wait
                  ? `Waiting period: ${wait} left`
                  : "Waiting period: any moment now",
      state:
        phase === "spendable"
          ? "done"
          : phase === "restricted"
            ? "failed"
            : phase === "standby"
              ? "active"
              : "todo",
    },
  );
  return steps;
}
