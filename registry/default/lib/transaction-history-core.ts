import type { Address, Hash, TransactionReceipt } from "viem";

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
const EMPTY: readonly HistoryEntry[] = [];
const listeners = new Set<() => void>();
let cache: HistoryEntry[] | undefined;

function load(): readonly HistoryEntry[] {
  if (cache) return cache;
  if (typeof localStorage === "undefined") return EMPTY;
  try {
    cache = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    cache = [];
  }
  return cache!;
}

function save(entries: readonly HistoryEntry[]) {
  cache = entries.slice(0, LIMIT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Storage blocked or full: history lasts for this page only.
  }
  for (const listener of [...listeners]) listener();
}

function onStorage(e: StorageEvent) {
  if (e.key !== STORAGE_KEY) return;
  cache = undefined;
  for (const listener of [...listeners]) listener();
}

/**
 * Transactions recorded in this browser, newest first, shared by every tab
 * (localStorage). Framework-free: read it with `get` and `subscribe`.
 */
export const transactionHistory = {
  get: load,
  /** What a server renders: nothing, since history lives in the browser. */
  getServerSnapshot: () => EMPTY,
  subscribe(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1 && typeof window !== "undefined") {
      window.addEventListener("storage", onStorage);
    }
    return () => {
      if (!listeners.delete(listener)) return;
      if (listeners.size === 0 && typeof window !== "undefined") {
        window.removeEventListener("storage", onStorage);
      }
    };
  },
};

/**
 * Add a transaction to the history. Call it from anywhere, e.g. a
 * TransactionButton's `onSubmitted`. Re-recording a hash updates it.
 */
export function recordTransaction(
  entry: Omit<HistoryEntry, "submittedAt" | "status"> &
    Partial<Pick<HistoryEntry, "submittedAt" | "status">>,
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

/** Entries sent by `from`, plus those with no sender. All of them when `from` is undefined. */
export function filterTransactions(entries: readonly HistoryEntry[], from: Address | undefined) {
  if (!from) return entries;
  const sender = from.toLowerCase();
  return entries.filter((e) => !e.from || e.from.toLowerCase() === sender);
}

/** The status a receipt settles an entry to. */
export function receiptStatus(receipt: Pick<TransactionReceipt, "status">): HistoryStatus {
  return receipt.status === "success" ? "confirmed" : "reverted";
}

/**
 * An entry's status, given its receipt once mined. Entries from an indexer
 * aren't in the local store, so the receipt settles them too.
 */
export function entryStatus(
  entry: Pick<HistoryEntry, "status">,
  receipt: Pick<TransactionReceipt, "status"> | undefined,
): HistoryStatus {
  return entry.status === "pending" && receipt ? receiptStatus(receipt) : entry.status;
}

/** "2 minutes ago", from a timestamp in ms. */
export function formatRelativeTime(ms: number, { locale, now = Date.now() }: { locale?: string; now?: number } = {}) {
  const seconds = Math.round((ms - now) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return format.format(seconds, "second");
  if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return format.format(Math.round(seconds / 3600), "hour");
  return format.format(Math.round(seconds / 86400), "day");
}
