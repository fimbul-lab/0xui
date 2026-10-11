import { useQuery } from "@tanstack/react-query";
import { CheckIcon, CircleIcon, Loader2Icon, XIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { Hash, TransactionReceipt } from "viem";
import {
  useChainId,
  usePublicClient,
  useTransactionConfirmations,
} from "wagmi";
import { CopyButton } from "@/components/copy-button";
import { ExplorerLink } from "@/components/explorer-link";
import { truncateAddress } from "@/lib/0xui-utils";
import { cn } from "@/lib/utils";

export type TxStatusPhase =
  | "pending"
  | "confirming"
  | "confirmed"
  | "reverted"
  | "error";

/**
 * Wait for a transaction to be mined. Unlike wagmi's
 * useWaitForTransactionReceipt, a reverted transaction resolves with its
 * receipt (`status: "reverted"`) instead of throwing, so the UI can show it.
 */
export function useMinedReceipt({
  hash,
  chainId,
}: {
  hash: Hash | undefined;
  chainId: number | undefined;
}) {
  const client = usePublicClient({ chainId });
  return useQuery({
    queryKey: ["0xui", "mined-receipt", chainId, hash],
    queryFn: () => client!.waitForTransactionReceipt({ hash: hash! }),
    enabled: Boolean(hash && client),
    staleTime: Infinity,
    retry: false,
  });
}

export type UseTransactionStatusParameters = {
  hash: Hash;
  /** Chain the transaction was sent on. Defaults to the current chain. */
  chainId?: number;
  /** Confirmations required before the transaction counts as confirmed. */
  confirmations?: number;
};

/** Track a transaction from submitted to confirmed, with a live confirmation count. */
export function useTransactionStatus({
  hash,
  chainId: chainIdProp,
  confirmations = 1,
}: UseTransactionStatusParameters) {
  const currentChainId = useChainId();
  const chainId = chainIdProp ?? currentChainId;

  const receipt = useMinedReceipt({ hash, chainId });
  const mined = receipt.data;
  const count = useTransactionConfirmations({
    hash,
    chainId,
    query: {
      enabled: Boolean(mined) && mined?.status === "success" && confirmations > 1,
      refetchInterval: 4_000,
    },
  });

  const confirmationCount = mined
    ? confirmations > 1
      ? Number(count.data ?? 1n)
      : 1
    : 0;

  const phase: TxStatusPhase = receipt.isError
    ? "error"
    : !mined
      ? "pending"
      : mined.status === "reverted"
        ? "reverted"
        : confirmationCount >= confirmations
          ? "confirmed"
          : "confirming";

  return {
    phase,
    chainId,
    receipt: mined,
    confirmations: Math.min(confirmationCount, confirmations),
    required: confirmations,
    error: receipt.error,
  };
}

export type TransactionStatusProps = UseTransactionStatusParameters & {
  /** Heading. Defaults to a phase description such as "Transaction pending". */
  title?: ReactNode;
  /** What the transaction does, e.g. "Send 0.5 ETH to vitalik.eth". */
  children?: ReactNode;
  /** Called once when the transaction reaches the required confirmations. */
  onConfirmed?: (receipt: TransactionReceipt) => void;
  className?: string;
};

const headings: Record<TxStatusPhase, string> = {
  pending: "Transaction pending",
  confirming: "Confirming",
  confirmed: "Transaction confirmed",
  reverted: "Transaction reverted",
  error: "Couldn't track transaction",
};

/**
 * Inline card for one transaction: what it does, a step list from submitted
 * to confirmed, the hash, and an explorer link. Never a bare spinner.
 */
export function TransactionStatus({
  hash,
  chainId,
  confirmations,
  title,
  children,
  onConfirmed,
  className,
}: TransactionStatusProps) {
  const status = useTransactionStatus({ hash, chainId, confirmations });
  const { phase, receipt } = status;

  const reported = useRef(false);
  useEffect(() => {
    if (phase === "confirmed" && receipt && !reported.current) {
      reported.current = true;
      onConfirmed?.(receipt);
    }
    // Only a phase change should fire the callback.
  }, [phase, receipt]);

  const steps: { label: ReactNode; state: StepState }[] = [
    { label: "Submitted", state: "done" },
    {
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
  if (status.required > 1 && phase !== "reverted") {
    steps.push({
      label: `${status.confirmations} of ${status.required} confirmations`,
      state:
        phase === "confirmed" ? "done" : phase === "confirming" ? "active" : "todo",
    });
  }

  return (
    <div
      data-slot="transaction-status"
      data-phase={phase}
      className={cn("flex flex-col gap-3 rounded-xl border p-4 text-sm", className)}
    >
      <div className="flex flex-col gap-1">
        <p
          role="status"
          className={cn(
            "font-medium",
            phase === "confirmed" && "text-emerald-600 dark:text-emerald-400",
            (phase === "reverted" || phase === "error") && "text-destructive"
          )}
        >
          {title ?? headings[phase]}
        </p>
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>

      <ol className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <li key={i} className="flex items-center gap-2">
            <StepIcon state={step.state} />
            <span className={cn(step.state === "todo" && "text-muted-foreground")}>
              {step.label}
            </span>
          </li>
        ))}
      </ol>

      {phase === "error" && (
        <p role="alert" className="text-destructive">
          The transaction wasn't found or the RPC stopped responding. Check the
          explorer for its current state.
        </p>
      )}

      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
          {truncateAddress(hash, { start: 10, end: 8 })}
          <CopyButton value={hash} label="Copy transaction hash" />
        </span>
        <ExplorerLink tx={hash} chainId={status.chainId} className="text-xs" />
      </div>
    </div>
  );
}

type StepState = "done" | "active" | "failed" | "todo";

function StepIcon({ state }: { state: StepState }) {
  const className = "size-4 shrink-0";
  if (state === "done")
    return <CheckIcon aria-label="Done" className={cn(className, "text-emerald-500")} />;
  if (state === "failed")
    return <XIcon aria-label="Failed" className={cn(className, "text-destructive")} />;
  if (state === "active")
    return (
      <Loader2Icon
        aria-label="In progress"
        className={cn(className, "animate-spin text-muted-foreground")}
      />
    );
  return <CircleIcon aria-label="Not started" className={cn(className, "text-muted-foreground")} />;
}
