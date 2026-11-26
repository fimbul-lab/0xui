import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTransactionHistory,
  entryStatus,
  filterTransactions,
  formatRelativeTime,
  recordTransaction,
  transactionHistory,
  updateTransaction,
} from "./transaction-history-core";
import type { HistoryEntry } from "./transaction-history-core";

const hash = `0x${"ab".repeat(32)}` as const;
const me = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as const;

describe("transactionHistory", () => {
  beforeEach(() => clearTransactionHistory());

  it("records, updates and persists entries", () => {
    const listener = vi.fn();
    const stop = transactionHistory.subscribe(listener);

    recordTransaction({ hash, chainId: 1, description: "Send", submittedAt: 1 });
    expect(transactionHistory.get()).toEqual([
      { hash, chainId: 1, description: "Send", submittedAt: 1, status: "pending" },
    ]);
    updateTransaction(hash, { status: "confirmed" });
    expect(transactionHistory.get()[0]!.status).toBe("confirmed");
    expect(JSON.parse(localStorage.getItem("0xui:transactions")!)[0].status).toBe("confirmed");
    expect(listener).toHaveBeenCalledTimes(2);

    stop();
    clearTransactionHistory();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(transactionHistory.getServerSnapshot()).toEqual([]);
  });

  it("filters by sender, keeping entries without one", () => {
    const entries: Array<HistoryEntry> = [
      { hash, chainId: 1, from: me, submittedAt: 0, status: "pending" },
      {
        hash,
        chainId: 1,
        from: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
        submittedAt: 0,
        status: "pending",
      },
      { hash, chainId: 1, submittedAt: 0, status: "pending" },
    ];
    expect(filterTransactions(entries, me.toLowerCase() as never)).toHaveLength(2);
    expect(filterTransactions(entries, undefined)).toHaveLength(3);
  });

  it("settles pending entries from their receipt", () => {
    expect(entryStatus({ status: "pending" }, { status: "success" })).toBe("confirmed");
    expect(entryStatus({ status: "pending" }, { status: "reverted" })).toBe("reverted");
    expect(entryStatus({ status: "pending" }, undefined)).toBe("pending");
    expect(entryStatus({ status: "confirmed" }, { status: "reverted" })).toBe("confirmed");
  });

  it("formats relative time", () => {
    expect(formatRelativeTime(0, { locale: "en", now: 120_000 })).toBe("2 minutes ago");
    expect(formatRelativeTime(0, { locale: "en", now: 0 })).toBe("now");
  });
});
