// Docs: https://0xui.io/components/transaction-status.md
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, CircleIcon, Loader2Icon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { Hash, TransactionReceipt } from "viem";
import { useChainId, useConfig } from "wagmi";
import { CopyButton } from "@/components/copy-button";
import { ExplorerLink } from "@/components/explorer-link";
import { errorCode, truncateAddress } from "@/lib/0xui-utils";
import {
  minedReceiptQueryOptions,
  transactionConfirmationsQueryOptions,
  transactionStatus,
  transactionSteps,
} from "@/lib/transaction-status-core";
import type { StepState, TxStatusPhase } from "@/lib/transaction-status-core";
import { cn } from "@/lib/utils";

export type { StepState, TxStatusPhase };

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
  const config = useConfig();
  return useQuery(minedReceiptQueryOptions(config, { hash, chainId }));
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
  const config = useConfig();
  const currentChainId = useChainId();
  const chainId = chainIdProp ?? currentChainId;

  const receipt = useMinedReceipt({ hash, chainId });
  const mined = receipt.data;
  const count = useQuery(
    transactionConfirmationsQueryOptions(config, {
      hash,
      chainId,
      enabled: mined?.status === "success" && confirmations > 1,
    }),
  );

  return {
    ...transactionStatus({
      receipt: mined,
      failed: receipt.isError,
      count: count.data,
      required: confirmations,
    }),
    chainId,
    receipt: mined,
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

  const steps = transactionSteps(status);

  return (
    <div
      data-slot="transaction-status"
      data-phase={phase}
      data-error={errorCode(phase, status.error)}
      className={cn("flex flex-col gap-3 rounded-xl border p-4 text-sm", className)}
    >
      <div className="flex flex-col gap-1">
        <p
          role="status"
          className={cn(
            "font-medium",
            phase === "confirmed" && "text-emerald-600 dark:text-emerald-400",
            (phase === "reverted" || phase === "error") && "text-destructive",
          )}
        >
          {title ?? headings[phase]}
        </p>
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>

      <ol className="flex flex-col gap-2">
        {steps.map((step) => (
          <li key={step.id} className="flex items-center gap-2">
            <StepIcon state={step.state} />
            <span className={cn(step.state === "todo" && "text-muted-foreground")}>
              {step.label}
            </span>
          </li>
        ))}
      </ol>

      {phase === "error" && (
        <p role="alert" className="text-destructive">
          The transaction wasn't found or the RPC stopped responding. Check the explorer for its
          current state.
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

/** Icon for one step of a status list: a check, a spinner, a cross or an empty circle. */
export function StepIcon({ state }: { state: StepState }) {
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
