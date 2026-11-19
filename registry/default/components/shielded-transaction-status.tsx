import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Hash } from "viem";
import { useBlock } from "wagmi";
import { CopyButton } from "@/components/copy-button";
import { ExplorerLink } from "@/components/explorer-link";
import { useShieldedEngine, useShieldedState } from "@/components/shielded-provider";
import { TokenAmount } from "@/components/token-amount";
import { StepIcon, useMinedReceipt, type StepState } from "@/components/transaction-status";
import { truncateAddress } from "@/lib/0xui-utils";
import type { ShieldedTransaction } from "@/lib/shielded-engine";
import { cn } from "@/lib/utils";

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
  const receipt = useMinedReceipt({ hash, chainId });
  const mined = receipt.data;
  const transaction = useShieldedState(
    "balances",
    (e) => e.getTransaction(chainId, hash),
    undefined
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
  const block = useBlock({
    blockNumber: mined?.blockNumber,
    chainId,
    query: { enabled: Boolean(mined) && standby !== undefined, staleTime: Infinity },
  });
  const spendableAt =
    block.data && standby !== undefined
      ? (Number(block.data.timestamp) + standby) * 1_000
      : undefined;

  // What the private side says wins: it is the balance that matters.
  const phase: ShieldedTxStatusPhase = transaction
    ? transaction.state === "spendable"
      ? "spendable"
      : transaction.state === "restricted"
        ? "restricted"
        : "standby"
    : receipt.isError
      ? "error"
      : !mined
        ? "pending"
        : mined.status === "reverted"
          ? "reverted"
          : "confirmed";

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

const headings: Record<ShieldedTxStatusPhase, string> = {
  pending: "Shield pending",
  confirmed: "Confirmed, updating private balance",
  standby: "Shielded, not spendable yet",
  spendable: "Shielded and spendable",
  restricted: "Shielded, but restricted",
  reverted: "Shield reverted",
  error: "Couldn't track shield",
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
  const wait = secondsLeft === undefined ? undefined : formatWait(secondsLeft);

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

  const steps: { label: ReactNode; state: StepState }[] = [
    { label: "Submitted", state: "done" },
    {
      label: receipt
        ? `Included in block ${receipt.blockNumber.toLocaleString()}`
        : found
          ? "Included in a block"
          : "Waiting to be included in a block",
      state:
        phase === "reverted" || phase === "error" ? "failed" : receipt || found ? "done" : "active",
    },
  ];
  if (phase !== "reverted" && phase !== "error") {
    steps.push(
      {
        label: found ? "Added to your private balance" : "Updating your private balance",
        state: found ? "done" : phase === "confirmed" ? "active" : "todo",
      },
      {
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
      }
    );
  }

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
              "text-destructive"
          )}
        >
          {title ?? headings[phase]}
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
        {steps.map((step, i) => (
          <li key={i} className="flex items-center gap-2">
            <StepIcon state={step.state} />
            <span className={cn("tabular-nums", step.state === "todo" && "text-muted-foreground")}>
              {step.label}
            </span>
          </li>
        ))}
      </ol>

      {phase === "restricted" && (
        <p role="alert" className="text-destructive">
          These funds can't be spent privately. They can only go back to the address they came
          from.
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
