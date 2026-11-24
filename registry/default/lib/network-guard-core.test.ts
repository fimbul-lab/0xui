import { connect } from "@wagmi/core";
import { describe, expect, it } from "vitest";
import { createTestConfig } from "../../../test/wagmi";
import { createNetworkGuard } from "./network-guard-core";

describe("createNetworkGuard", () => {
  it("is ok without a wallet", () => {
    const guard = createNetworkGuard(createTestConfig(), 11155111);
    expect(guard.get()).toMatchObject({ phase: "ok", wrongNetwork: false });
    expect(guard.get().target?.name).toBe("Sepolia");
  });

  it("spots the wrong network and switches without any framework", async () => {
    const config = createTestConfig();
    const guard = createNetworkGuard(config, [11155111]);
    const stop = guard.subscribe(() => {});
    await connect(config, { connector: config.connectors[0]! });
    expect(guard.get()).toMatchObject({ phase: "wrong-network", currentChainId: 1 });

    const switching = guard.switchToTarget();
    expect(guard.get().phase).toBe("switching");
    expect(await switching).toBe(true);
    expect(guard.get()).toMatchObject({ phase: "ok", wrongNetwork: false, currentChainId: 11155111 });
    stop();
  });

  it("reports a declined switch as cancelled", async () => {
    const config = createTestConfig({ features: { switchChainError: true } });
    await connect(config, { connector: config.connectors[0]! });
    const guard = createNetworkGuard(config, 11155111);

    expect(await guard.switchToTarget()).toBe(false);
    expect(guard.get()).toMatchObject({ phase: "wrong-network", cancelled: true, error: null });
  });
});
