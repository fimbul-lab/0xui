import { connect } from "@wagmi/core";
import { describe, expect, it, vi } from "vitest";
import { createTestConfig, fakeChainRpc } from "../../../test/wagmi";
import {
  batchStepState,
  createBatchTransaction,
  describeBatchCalls,
  supportsAtomic,
  type BatchCall,
} from "./batch-transaction-core";

const calls: BatchCall[] = [
  { to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", data: "0x095ea7b3", label: "Approve" },
  { to: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af", data: "0x1234", label: "Swap" },
];

const settled = (batch: { get(): { atomic: boolean } }, atomic: boolean) =>
  vi.waitFor(() => expect(batch.get().atomic).toBe(atomic));

describe("createBatchTransaction", () => {
  it("sends one transaction per call when the wallet can't batch", async () => {
    const sent = vi.fn();
    const chain = fakeChainRpc();
    const send = chain.eth_sendTransaction as (p: unknown) => unknown;
    const config = createTestConfig({
      rpc: { ...chain, eth_sendTransaction: (p: unknown) => (sent(), send(p)) },
    });
    await connect(config, { connector: config.connectors[0]! });
    const batch = createBatchTransaction(config, { chainId: 1 });
    const phases: string[] = [];
    const stop = batch.subscribe(() => phases.push(batch.get().phase));

    expect(batch.get()).toMatchObject({ isConnected: true, wrongChain: false, atomic: false });
    await batch.execute(calls);

    expect(batch.get()).toMatchObject({ phase: "success", step: 2 });
    expect(sent).toHaveBeenCalledTimes(2);
    expect(phases).toContain("confirming");
    expect(phases).toContain("pending");
    stop();
  });

  it("goes atomic when the wallet supports it", async () => {
    const config = createTestConfig({
      rpc: fakeChainRpc(),
      capabilities: { 1: { atomic: { status: "supported" } } },
    });
    await connect(config, { connector: config.connectors[0]! });
    const batch = createBatchTransaction(config, { chainId: 1 });
    const stop = batch.subscribe(() => {});

    await settled(batch, true);
    await batch.execute(calls);
    expect(batch.get()).toMatchObject({ phase: "success", step: 2 });
    stop();
  });

  it("reports a wallet rejection as cancelled", async () => {
    const config = createTestConfig({
      rpc: {
        ...fakeChainRpc(),
        eth_sendTransaction: () => {
          throw { code: 4001, message: "User rejected the request." };
        },
      },
    });
    await connect(config, { connector: config.connectors[0]! });
    const batch = createBatchTransaction(config, { chainId: 1, mode: "sequential" });

    await batch.execute(calls);
    expect(batch.get().phase).toBe("cancelled");
    expect(batchStepState(batch.get(), 0)).toBe("todo");
    batch.reset();
    expect(batch.get()).toMatchObject({ phase: "idle", error: undefined });
  });

  it("stops at a reverted step", async () => {
    const config = createTestConfig({ rpc: fakeChainRpc({ status: "reverted" }) });
    await connect(config, { connector: config.connectors[0]! });
    const batch = createBatchTransaction(config, { chainId: 1, mode: "sequential" });

    await batch.execute(calls);
    expect(batch.get()).toMatchObject({ phase: "reverted", step: 0 });
    expect(batchStepState(batch.get(), 0)).toBe("failed");
    expect(batchStepState(batch.get(), 1)).toBe("todo");
  });

  it("notices the wrong chain and switches", async () => {
    const config = createTestConfig({ rpc: fakeChainRpc() });
    await connect(config, { connector: config.connectors[0]! });
    const batch = createBatchTransaction(config, { chainId: 11155111 });
    const stop = batch.subscribe(() => {});

    expect(batch.get()).toMatchObject({ wrongChain: true, targetChain: { name: "Sepolia" } });
    await batch.switchToTarget();
    expect(batch.get()).toMatchObject({ phase: "idle", wrongChain: false });
    stop();
  });
});

describe("batch helpers", () => {
  it("reads atomic support from capabilities", () => {
    expect(supportsAtomic({ atomic: { status: "ready" } })).toBe(true);
    expect(supportsAtomic({ atomic: { status: "unsupported" } })).toBe(false);
    expect(supportsAtomic(undefined)).toBe(false);
  });

  it("places each step", () => {
    expect(batchStepState({ phase: "pending", step: 1 }, 0)).toBe("done");
    expect(batchStepState({ phase: "pending", step: 1 }, 1)).toBe("active");
    expect(batchStepState({ phase: "error", step: 1 }, 1)).toBe("failed");
    expect(batchStepState({ phase: "success", step: 2 }, 1)).toBe("done");
  });
});

describe("describeBatchCalls", () => {
  it("lists the calls in order, by label or position", () => {
    expect(describeBatchCalls(calls)).toBe("Approve, then Swap");
    expect(describeBatchCalls([{ label: "Approve" }, {}])).toBe("Approve, then Step 2");
  });
});
