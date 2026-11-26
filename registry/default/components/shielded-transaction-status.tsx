// Docs: https://0xui.io/components/shielded-transaction-status.md
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Hash } from "viem";
import { useConfig } from "wagmi";
import { CopyButton } from "@/components/copy-button";
import { ExplorerLink } from "@/components/explorer-link";
import { useShieldedEngine, useShieldedState } from "@/components/shielded-provider";
import { TokenAmount } from "@/components/token-amount";
import { StepIcon, useMinedReceipt } from "@/components/transaction-status";
import { truncateAddress } from "@/lib/0xui-utils";
import type { ShieldedTransaction } from "@/lib/shielded-engine";
import {
  formatWait,
  shieldedStatusText,
  shieldedTxHeadings,
  shieldedTxPhase,
  shieldedTxSteps,
  spendableAt as standbyEnd,
  standbyBlockQueryOptions,
  type ShieldedTxStatusPhase,
} from "@/lib/shielded-transaction-status-core";
import { cn } from "@/lib/utils";

export { formatWait, shieldedStatusText, type ShieldedTxStatusPhase };

/** Seconds until `target` (Unix ms), counting down, or undefined without a target. */
function useSecondsUntil(target: number | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (target === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [target]);
  return target === undefined ? undefined : Math.max(0, Math.ceil((target - now) / 1_000));
}

export type UseShieldedTransactionStatusParameters = {
  /** The public transaction, e.g. the shield. */
  hash: Hash;
  /** Chain it was sent on. */
  chainId: number;
  /** Seconds funds stay pending after it is mined, from the shield quote. Enables the countdown. */
  standby?: number;
};

/**
 * Follow a shield from the public chain into the private balance. A mined
 * transaction is only "confirmed": it counts as shielded once the engine's
 * scan has found it, and as done once the funds are spendable.
 */
export function useShieldedTransactionStatus({
  hash,
  chainId,
  standby,
}: UseShieldedTransactionStatusParameters) {
  const engine = useShieldedEngine();
  const config = useConfig();
  const receipt = useMinedReceipt({ hash, chainId });
  const mined = receipt.data;
  const transaction = useShieldedState(
    "balances",
    (e) => e.getTransaction(chainId, hash),
    undefined,
  );

  // The engine only learns about a public transaction by scanning. Ask for a
  // scan as soon as it is mined, instead of waiting for the engine's next one.
  const nudged = useRef<Hash>(undefined);
  useEffect(() => {
    if (mined?.status !== "success" || nudged.current === hash) return;
    nudged.current = hash;
    void engine.sync(chainId);
  }, [mined, hash, chainId, engine]);

  // The standby period runs from the block the transaction was mined in.
  const block = useQuery(
    standbyBlockQueryOptions(config, { chainId, blockNumber: mined?.blockNumber, standby }),
  );
  const spendableAt = standbyEnd(block.data?.timestamp, standby);

  const phase = shieldedTxPhase({ transaction, receipt: mined, receiptFailed: receipt.isError });

  const secondsLeft = useSecondsUntil(phase === "standby" ? spendableAt : undefined);

  return {
    phase,
    chainId,
    /** The public receipt, once mined. */
    receipt: mined,
    /** What the private account received, once a scan has found the transaction. */
    transaction,
    /** Seconds of standby left. 0 when it should be over; undefined when unknown. */
    secondsLeft,
    error: receipt.error,
  };
}

export type ShieldedTransactionStatusProps = UseShieldedTransactionStatusParameters & {
  /** Symbol and decimals, to show the amount that arrived. */
  token?: { symbol: string; decimals: number };
  /** Heading. Defaults to a phase description such as "Shield pending". */
  title?: ReactNode;
  /** What the transaction does, e.g. "Shield 0.5 WETH". */
  children?: ReactNode;
  /** Called once when the funds become spendable. */
  onSpendable?: (transaction: ShieldedTransaction) => void;
  /** "card" lists every step. "line" is one line of status, for under a form. */
  variant?: "card" | "line";
  className?: string;
};

/**
 * Inline card for one shield, from the public transaction to a spendable
 * private balance: submitted, included in a block, found by the private
 * account, then the standby period with a countdown. A mined transaction
 * alone is never shown as done.
 */
export function ShieldedTransactionStatus({
  hash,
  chainId,
  standby,
  token,
  title,
  children,
  onSpendable,
  variant = "card",
  className,
}: ShieldedTransactionStatusProps) {
  const status = useShieldedTransactionStatus({ hash, chainId, standby });
  const { phase, receipt, transaction, secondsLeft } = status;

  const reported = useRef(false);
  useEffect(() => {
    if (phase === "spendable" && transaction && !reported.current) {
      reported.current = true;
      onSpendable?.(transaction);
    }
    // Only a phase change should fire the callback.
  }, [phase, transaction]);

  const found = transaction !== undefined;

  if (variant === "line") {
    const failed = phase === "restricted" || phase === "reverted" || phase === "error";
    return (
      <p
        data-slot="shielded-transaction-status"
        data-phase={phase}
        role="status"
        className={cn("flex items-center gap-2 text-sm", className)}
      >
        <StepIcon state={phase === "spendable" ? "done" : failed ? "failed" : "active"} />
        <span className={cn("min-w-0 flex-1 truncate tabular-nums", failed && "text-destructive")}>
          {children}
          {children ? ": " : ""}
          {shieldedStatusText(phase, secondsLeft)}
        </span>
        {phase === "spendable" && transaction && token && (
          <TokenAmount
            value={transaction.amount}
            decimals={token.decimals}
            symbol={token.symbol}
            className="shrink-0 font-medium"
          />
        )}
      </p>
    );
  }

  const steps = shieldedTxSteps({
    phase,
    blockNumber: receipt?.blockNumber,
    found,
    secondsLeft,
  });

  return (
    <div
      data-slot="shielded-transaction-status"
      data-phase={phase}
      className={cn("flex w-full flex-col gap-3 rounded-xl border p-4 text-sm", className)}
    >
      <div className="flex flex-col gap-1">
        <p
          role="status"
          className={cn(
            "font-medium",
            phase === "spendable" && "text-emerald-600 dark:text-emerald-400",
            (phase === "reverted" || phase === "error" || phase === "restricted") &&
              "text-destructive",
          )}
        >
          {title ?? shieldedTxHeadings[phase]}
        </p>
        {children && <div className="text-muted-foreground">{children}</div>}
        {transaction && token && (
          <p className="text-muted-foreground">
            <TokenAmount
              value={transaction.amount}
              decimals={token.decimals}
              symbol={token.symbol}
              className="inline-flex text-foreground"
            />{" "}
            arrived after the fee.
          </p>
        )}
      </div>

      <ol className="flex flex-col gap-2">
        {steps.map((step) => (
          <li key={step.id} className="flex items-center gap-2">
            <StepIcon state={step.state} />
            <span className={cn("tabular-nums", step.state === "todo" && "text-muted-foreground")}>
              {step.label}
            </span>
          </li>
        ))}
      </ol>

      {phase === "restricted" && (
        <p role="alert" className="text-destructive">
          These funds can't be spent privately. They can only go back to the address they came from.
        </p>
      )}
      {phase === "reverted" && (
        <p role="alert" className="text-destructive">
          Nothing was shielded. Only the gas fee was spent.
        </p>
      )}
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
