// Docs: https://0xui.io/components/transaction-history.md
import { Timeline, TimelineItem, TimelineTime, TimelineTitle } from "@ui-sdk/react/timeline";
import { CheckIcon, Loader2Icon, XIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { Address } from "viem";
import { useConnection } from "wagmi";
import { ExplorerLink } from "@/components/explorer-link";
import { Button } from "@/components/primitives/button";
import { useMinedReceipt } from "@/components/transaction-status";
import { truncateAddress } from "@/lib/0xui-utils";
import {
  clearTransactionHistory,
  entryStatus,
  filterTransactions,
  formatRelativeTime,
  receiptStatus,
  recordTransaction,
  transactionHistory,
  updateTransaction,
} from "@/lib/transaction-history-core";
import type { HistoryEntry } from "@/lib/transaction-history-core";
import { cn } from "@/lib/utils";

export {
  clearTransactionHistory,
  entryStatus,
  filterTransactions,
  recordTransaction,
  transactionHistory,
  updateTransaction,
  type HistoryEntry,
  type HistoryStatus,
} from "@/lib/transaction-history-core";

/** Recorded transactions, newest first. Pass `from` to keep only one account's. */
export function useTransactionHistory({ from }: { from?: Address } = {}) {
  const entries = useSyncExternalStore(
    transactionHistory.subscribe,
    transactionHistory.get,
    transactionHistory.getServerSnapshot,
  );
  return {
    transactions: filterTransactions(entries, from),
    record: recordTransaction,
    clear: clearTransactionHistory,
  };
}

function HistoryRow({ entry, locale }: { entry: HistoryEntry; locale?: string }) {
  // Only pending transactions are polled. Settled ones keep their stored status.
  const receipt = useMinedReceipt({
    hash: entry.status === "pending" ? entry.hash : undefined,
    chainId: entry.chainId,
  });
  useEffect(() => {
    if (receipt.data) {
      updateTransaction(entry.hash, { status: receiptStatus(receipt.data) });
    }
  }, [receipt.data, entry.hash]);

  const status = entryStatus(entry, receipt.data);
  // The status is also text, so the row reads in one piece, to screen readers
  // and agents alike: "Send 1 ETH, Confirmed · 2 min ago". The spaces between
  // parts keep words apart in that text. Flex layout drops them.
  return (
    <TimelineItem
      data-status={status}
      className="flex items-center gap-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {status === "pending" ? (
        <Loader2Icon aria-hidden className="size-4 shrink-0 animate-spin text-muted-foreground" />
      ) : status === "confirmed" ? (
        <CheckIcon aria-hidden className="size-4 shrink-0 text-emerald-500" />
      ) : (
        <XIcon aria-hidden className="size-4 shrink-0 text-destructive" />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <TimelineTitle className="truncate">
          {entry.description ?? (
            <span className="font-mono">{truncateAddress(entry.hash, { start: 10, end: 8 })}</span>
          )}
        </TimelineTitle>{" "}
        <span className="text-xs text-muted-foreground">
          {status !== "reverted" && (
            <span className="sr-only">{status === "pending" ? "Pending" : "Confirmed"} · </span>
          )}
          <TimelineTime dateTime={new Date(entry.submittedAt).toISOString()}>
            {formatRelativeTime(entry.submittedAt, { locale })}
          </TimelineTime>
          {status === "reverted" && " · Reverted"}
        </span>
      </div>{" "}
      <ExplorerLink
        tx={entry.hash}
        chainId={entry.chainId}
        className="shrink-0 text-xs text-muted-foreground"
      >
        View
      </ExplorerLink>
    </TimelineItem>
  );
}

export type TransactionHistoryProps = {
  /** Show only this account's transactions. Defaults to the connected account. Pass null for everyone's. */
  from?: Address | null;
  /**
   * Transactions from your own source, e.g. an indexer, instead of the ones
   * recorded in this browser. Pending entries still update live.
   */
  transactions?: ReadonlyArray<HistoryEntry>;
  /** Rows per page, with "Show more" for the rest. */
  pageSize?: number;
  /** Show a "Clear" button. */
  clearable?: boolean;
  title?: ReactNode;
  locale?: string;
  className?: string;
};

/**
 * Transactions sent from this app, newest first, with live status. Stored in
 * this browser (localStorage), so it's per device. Record entries with
 * `recordTransaction`.
 */
export function TransactionHistory({
  from: fromProp,
  transactions: transactionsProp,
  pageSize = 10,
  clearable = true,
  title = "Recent transactions",
  locale,
  className,
}: TransactionHistoryProps) {
  const { address } = useConnection();
  const from = fromProp === null ? undefined : (fromProp ?? address);
  const local = useTransactionHistory({ from });
  const transactions = transactionsProp ?? local.transactions;
  const [visible, setVisible] = useState(pageSize);
  const shown = transactions.slice(0, visible);

  return (
    <section
      data-slot="transaction-history"
      aria-label={typeof title === "string" ? title : "Recent transactions"}
      className={cn("flex flex-col gap-2 rounded-2xl border p-4", className)}
    >
      <header className="flex items-center justify-between gap-2">
        {title && <h3 className="font-semibold">{title}</h3>}
        {clearable && !transactionsProp && shown.length > 0 && (
          <Button variant="ghost" size="xs" onClick={local.clear}>
            Clear <span className="sr-only">transaction history</span>
          </Button>
        )}
      </header>
      {shown.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Transactions you send will show up here.
        </p>
      ) : (
        <Timeline
          aria-label={typeof title === "string" ? title : "Recent transactions"}
          className="flex flex-col divide-y"
        >
          {shown.map((entry) => (
            <HistoryRow key={entry.hash} entry={entry} locale={locale} />
          ))}
        </Timeline>
      )}
      {transactions.length > visible && (
        <Button
          variant="ghost"
          onClick={() => setVisible((v) => v + pageSize)}
          className="h-auto self-center rounded-md px-3 py-1.5 dark:hover:bg-muted"
        >
          {/* One run of text, so the button lays out as "Show more (5)". */}
          <span>
            Show more <span className="sr-only">transactions</span> ({transactions.length - visible}
            )
          </span>
        </Button>
      )}
    </section>
  );
}
