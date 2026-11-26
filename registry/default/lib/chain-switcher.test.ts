import { connect } from "@wagmi/core";
import { describe, expect, it } from "vitest";
import { createTestConfig } from "../../../test/wagmi";
import { createChainSwitcher } from "./chain-switcher";

describe("createChainSwitcher", () => {
  it("switches chain without any framework", async () => {
    const config = createTestConfig();
    await connect(config, { connector: config.connectors[0]! });
    const switcher = createChainSwitcher(config);
    const seen: Array<number | undefined> = [];
    const stop = switcher.subscribe(() => seen.push(switcher.get().pendingChainId));

    expect(switcher.get().currentChain?.name).toBe("Ethereum");
    expect(await switcher.switchTo(11_155_111)).toBe(true);
    expect(switcher.get().currentChain?.name).toBe("Sepolia");
    expect(seen[0]).toBe(11_155_111);
    expect(switcher.get().pendingChainId).toBeUndefined();
    stop();
  });

  it("reports a wallet rejection as cancelled", async () => {
    const config = createTestConfig({ features: { switchChainError: true } });
    await connect(config, { connector: config.connectors[0]! });
    const switcher = createChainSwitcher(config);

    expect(await switcher.switchTo(11_155_111)).toBe(false);
    expect(switcher.get()).toMatchObject({ cancelled: true, error: null });
    switcher.reset();
    expect(switcher.get().cancelled).toBe(false);
  });
});
