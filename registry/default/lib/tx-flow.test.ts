import { parseEther } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  connectMock,
  createTestConfig,
  fakeChainRpc,
  fakeTxHash,
  testAccounts,
} from "../../../test/wagmi";
import { createTransactionFlow, simulationStatus } from "./tx-flow";
import type { TxPhase } from "./tx-flow";

const send = { transaction: { to: testAccounts[1], value: parseEther("0.1") } };

function track(flow: ReturnType<typeof createTransactionFlow>) {
  const phases: Array<TxPhase> = [];
  const stop = flow.subscribe(() => {
    const { phase } = flow.get();
    if (phases.at(-1) !== phase) phases.push(phase);
  });
  return { phases, stop };
}

describe("createTransactionFlow", () => {
  it("goes from confirming to pending to success without any framework", async () => {
    const config = createTestConfig({ rpc: fakeChainRpc() });
    await connectMock(config);
    const onSubmitted = vi.fn();
    const onSuccess = vi.fn();
    const flow = createTransactionFlow(config, { onSubmitted, onSuccess });
    const { phases, stop } = track(flow);

    await flow.execute(send);

    expect(phases).toEqual(["confirming", "pending", "success"]);
    expect(flow.get()).toMatchObject({ hash: fakeTxHash, receipt: { status: "success" } });
    expect(onSubmitted).toHaveBeenCalledWith(fakeTxHash);
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ transactionHash: fakeTxHash }),
    );
    stop();
  });

  it("reports a reverted transaction through onError", async () => {
    const config = createTestConfig({ rpc: fakeChainRpc({ status: "reverted" }) });
    await connectMock(config);
    const onError = vi.fn();
    const flow = createTransactionFlow(config, { onError });

    await flow.execute(send);

    expect(flow.get().phase).toBe("reverted");
    expect(onError).toHaveBeenCalledOnce();
  });

  it("treats a wallet rejection as cancelled, not an error", async () => {
    const config = createTestConfig({
      rpc: {
        ...fakeChainRpc(),
        eth_sendTransaction: () => {
          throw { code: 4001, message: "User rejected the request." };
        },
      },
    });
    await connectMock(config);
    const onError = vi.fn();
    const flow = createTransactionFlow(config, { onError });

    await flow.execute(send);

    expect(flow.get().phase).toBe("cancelled");
    expect(onError).not.toHaveBeenCalled();
    flow.reset();
    expect(flow.get()).toMatchObject({ phase: "idle", error: undefined });
  });

  it("switches to the target chain when the wallet is on another", async () => {
    const config = createTestConfig({ rpc: fakeChainRpc() });
    await connectMock(config);
    const flow = createTransactionFlow(config, { chainId: 11_155_111 });
    const { phases, stop } = track(flow);

    expect(flow.get()).toMatchObject({ wrongChain: true, targetChain: { name: "Sepolia" } });
    await flow.switchToTarget();

    expect(phases[0]).toBe("switching");
    expect(flow.get()).toMatchObject({ phase: "idle", wrongChain: false });
    stop();
  });

  it("ignores a transaction that settles after a reset", async () => {
    const config = createTestConfig({ rpc: fakeChainRpc() });
    await connectMock(config);
    const onSuccess = vi.fn();
    const flow = createTransactionFlow(config, { onSuccess, onSubmitted: () => flow.reset() });

    await flow.execute(send);

    expect(flow.get().phase).toBe("idle");
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe("simulationStatus", () => {
  it("is idle until there is something to simulate", () => {
    expect(simulationStatus({ active: false, isError: true, isPending: true })).toBe("idle");
    expect(simulationStatus({ active: true, isError: false, isPending: true })).toBe("checking");
    expect(simulationStatus({ active: true, isError: true, isPending: false })).toBe("failed");
    expect(simulationStatus({ active: true, isError: false, isPending: false })).toBe("ok");
  });
});
