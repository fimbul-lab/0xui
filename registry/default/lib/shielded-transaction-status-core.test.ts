import { describe, expect, it } from "vitest";
import { shieldedTxPhase, shieldedTxSteps, spendableAt } from "./shielded-transaction-status-core";

const found = { kind: "shield", token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", amount: 1n } as const;

describe("shieldedTxPhase", () => {
  it("lets the private side win over the receipt", () => {
    expect(shieldedTxPhase({ transaction: undefined, receipt: undefined, receiptFailed: false })).toBe("pending");
    expect(shieldedTxPhase({ transaction: undefined, receipt: { status: "success" }, receiptFailed: false })).toBe(
      "confirmed"
    );
    expect(shieldedTxPhase({ transaction: undefined, receipt: { status: "reverted" }, receiptFailed: false })).toBe(
      "reverted"
    );
    expect(shieldedTxPhase({ transaction: undefined, receipt: undefined, receiptFailed: true })).toBe("error");
    expect(
      shieldedTxPhase({ transaction: { ...found, state: "pending" }, receipt: undefined, receiptFailed: true })
    ).toBe("standby");
    expect(
      shieldedTxPhase({ transaction: { ...found, state: "spendable" }, receipt: undefined, receiptFailed: false })
    ).toBe("spendable");
  });
});

describe("shieldedTxSteps", () => {
  it("lists every step, and stops after the block when it reverted", () => {
    const standby = shieldedTxSteps({ phase: "standby", blockNumber: 100n, found: true, secondsLeft: 45 });
    expect(standby.map((s) => [s.id, s.state, s.label])).toEqual([
      ["submitted", "done", "Submitted"],
      ["included", "done", "Included in block 100"],
      ["found", "done", "Added to your private balance"],
      ["spendable", "active", "Waiting period: 45 s left"],
    ]);
    const reverted = shieldedTxSteps({ phase: "reverted", blockNumber: 100n, found: false, secondsLeft: undefined });
    expect(reverted.map((s) => s.state)).toEqual(["done", "failed"]);
  });

  it("counts the standby from the block's timestamp", () => {
    expect(spendableAt(1_000n, 60)).toBe(1_060_000);
    expect(spendableAt(undefined, 60)).toBeUndefined();
  });
});
