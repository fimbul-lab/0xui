import type { TransactionReceipt } from "viem";
import { describe, expect, it } from "vitest";
import { createTestConfig, fakeChainRpc, fakeTxHash, testAccounts } from "../../../test/wagmi";
import {
  minedReceiptQueryOptions,
  transactionStatus,
  transactionSteps,
} from "./transaction-status-core";

const receipt = (status: "success" | "reverted") =>
  ({ status, blockNumber: 100n, transactionHash: fakeTxHash }) as TransactionReceipt;

describe("minedReceiptQueryOptions", () => {
  it("resolves a reverted transaction with its receipt instead of throwing", async () => {
    const chain = fakeChainRpc({ status: "reverted" });
    (chain.eth_sendTransaction as (params: unknown) => unknown)([
      { from: testAccounts[0], to: testAccounts[1] },
    ]);
    const config = createTestConfig({ rpc: chain });
    const options = minedReceiptQueryOptions(config, { hash: fakeTxHash, chainId: 1 });

    expect(options.enabled).toBe(true);
    expect(await options.queryFn()).toMatchObject({ status: "reverted" });
  });

  it("stays off without a hash", () => {
    const config = createTestConfig();
    expect(minedReceiptQueryOptions(config, { hash: undefined, chainId: 1 }).enabled).toBe(false);
  });
});

describe("transactionStatus", () => {
  it("moves from pending through confirming to confirmed", () => {
    const pending = transactionStatus({
      receipt: undefined,
      failed: false,
      count: undefined,
      required: 3,
    });
    expect(pending).toEqual({ phase: "pending", confirmations: 0, required: 3 });

    const mined = { receipt: receipt("success"), failed: false, required: 3 };
    expect(transactionStatus({ ...mined, count: 2n }).phase).toBe("confirming");
    expect(transactionStatus({ ...mined, count: 5n })).toEqual({
      phase: "confirmed",
      confirmations: 3,
      required: 3,
    });
  });

  it("lists a confirmations step only when more than one is required", () => {
    const status = transactionStatus({
      receipt: receipt("success"),
      failed: false,
      count: 2n,
      required: 3,
    });
    const steps = transactionSteps({ ...status, receipt: receipt("success") });
    expect(steps.map((s) => [s.id, s.state])).toEqual([
      ["submitted", "done"],
      ["included", "done"],
      ["confirmations", "active"],
    ]);

    const reverted = transactionStatus({
      receipt: receipt("reverted"),
      failed: false,
      count: undefined,
    });
    expect(transactionSteps({ ...reverted, receipt: receipt("reverted") }).at(-1)).toMatchObject({
      label: "Included in block 100",
      state: "failed",
    });
  });
});
