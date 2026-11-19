// Docs: https://0xui.io/components/transaction-history.md
import { CheckIcon, Loader2Icon, XIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Address, Hash } from "viem";
import { useConnection } from "wagmi";
import { ExplorerLink } from "@/components/explorer-link";
import { useMinedReceipt } from "@/components/transaction-status";
import { Button } from "@/components/ui/button";
import { truncateAddress } from "@/lib/0xui-utils";
import { cn } from "@/lib/utils";

export type HistoryStatus = "pending" | "confirmed" | "reverted";

export type HistoryEntry = {
  hash: Hash;
  chainId: number;
  /** Sender, so the list can show only the connected account's transactions. */
  from?: Address;
  /** What the transaction did, e.g. "Swap 1 ETH for USDC". */
  description?: string;
  /** Unix time in ms. */
  submittedAt: number;
  /** Stored once the transaction settles, so it isn't polled again. */
  status: HistoryStatus;
};

const STORAGE_KEY = "0xui:transactions";
const LIMIT = 50;
const EMPTY: HistoryEntry[] = [];
const listeners = new Set<() => void>();
let cache: HistoryEntry[] | undefined;

function load(): HistoryEntry[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    cache = [];
  }
  return cache!;
}

function save(entries: HistoryEntry[]) {
  cache = entries.slice(0, LIMIT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Storage blocked or full: history lasts for this page only.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Other tabs.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    cache = undefined;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Add a transaction to the history. Call it from anywhere, e.g. a
 * TransactionButton's `onSubmitted`. Re-recording a hash updates it.
 */
export function recordTransaction(
  entry: Omit<HistoryEntry, "submittedAt" | "status"> &
    Partial<Pick<HistoryEntry, "submittedAt" | "status">>
) {
  const rest = load().filter((e) => e.hash !== entry.hash);
  save([{ submittedAt: Date.now(), status: "pending", ...entry }, ...rest]);
}

export function updateTransaction(hash: Hash, update: Partial<HistoryEntry>) {
  save(load().map((e) => (e.hash === hash ? { ...e, ...update } : e)));
}

export function clearTransactionHistory() {
  save([]);
}

/** Recorded transactions, newest first. Pass `from` to keep only one account's. */
export function useTransactionHistory({ from }: { from?: Address } = {}) {
  const entries = useSyncExternalStore(subscribe, load, () => EMPTY);
  const transactions = from
    ? entries.filter((e) => !e.from || e.from.toLowerCase() === from.toLowerCase())
    : entries;
  return {
    transactions,
    record: recordTransaction,
    clear: clearTransactionHistory,
  };
}

const relative = (ms: number, locale?: string) => {
  const seconds = Math.round((ms - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return format.format(seconds, "second");
  if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return format.format(Math.round(seconds / 3600), "hour");
  return format.format(Math.round(seconds / 86400), "day");
};

function HistoryRow({ entry, locale }: { entry: HistoryEntry; locale?: string }) {
  // Only pending transactions are polled. Settled ones keep their stored status.
  const receipt = useMinedReceipt({
    hash: entry.status === "pending" ? entry.hash : undefined,
    chainId: entry.chainId,
  });
  useEffect(() => {
    if (receipt.data) {
      updateTransaction(entry.hash, {
        status: receipt.data.status === "success" ? "confirmed" : "reverted",
      });
    }
  }, [receipt.data, entry.hash]);

  // Entries from an indexer aren't in the local store, so derive the status too.
  const status: HistoryStatus =
    entry.status === "pending" && receipt.data
      ? receipt.data.status === "success"
        ? "confirmed"
        : "reverted"
      : entry.status;
  return (
    <li data-status={status} className="flex items-center gap-3 py-2 text-sm">
      {status === "pending" ? (
        <Loader2Icon aria-label="Pending" className="size-4 shrink-0 animate-spin text-muted-foreground" />
      ) : status === "confirmed" ? (
        <CheckIcon aria-label="Confirmed" className="size-4 shrink-0 text-emerald-500" />
      ) : (
        <XIcon aria-label="Reverted" className="size-4 shrink-0 text-destructive" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">
          {entry.description ?? <span className="font-mono">{truncateAddress(entry.hash, { start: 10, end: 8 })}</span>}
        </span>
        <span className="text-xs text-muted-foreground">
          <time dateTime={new Date(entry.submittedAt).toISOString()}>{relative(entry.submittedAt, locale)}</time>
          {status === "reverted" && " · Reverted"}
        </span>
      </span>
      <ExplorerLink tx={entry.hash} chainId={entry.chainId} className="shrink-0 text-xs text-muted-foreground">
        View
      </ExplorerLink>
    </li>
  );
}

export type TransactionHistoryProps = {
  /** Show only this account's transactions. Defaults to the connected account. Pass null for everyone's. */
  from?: Address | null;
  /**
   * Transactions from your own source, e.g. an indexer, instead of the ones
   * recorded in this browser. Pending entries still update live.
   */
  transactions?: readonly HistoryEntry[];
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
            Clear
          </Button>
        )}
      </header>
      {shown.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Transactions you send will show up here.
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {shown.map((entry) => (
            <HistoryRow key={entry.hash} entry={entry} locale={locale} />
          ))}
        </ul>
      )}
      {transactions.length > visible && (
        <button
          type="button"
          onClick={() => setVisible((v) => v + pageSize)}
          className="self-center rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          Show more ({transactions.length - visible})
        </button>
      )}
    </section>
  );
}
