import { connect } from "@wagmi/core";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { createTestConfig } from "../../../test/wagmi";
import { createTokenAdder } from "./add-token-core";

const usdc = {
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
  symbol: "USDC",
  decimals: 6,
};

describe("createTokenAdder", () => {
  it("follows the connection and adds the token", async () => {
    const config = createTestConfig();
    const adder = createTokenAdder(config);
    const stop = adder.subscribe(() => {});
    expect(adder.get().connected).toBe(false);

    await connect(config, { connector: config.connectors[0]! });
    expect(adder.get().connected).toBe(true);
    expect(await adder.add(usdc)).toBe(true);
    expect(adder.get().phase).toBe("added");
    stop();
  });

  it("reports a declined prompt as cancelled", async () => {
    const config = createTestConfig({ features: { watchAssetError: true } });
    await connect(config, { connector: config.connectors[0]! });
    const adder = createTokenAdder(config);

    expect(await adder.add(usdc)).toBe(false);
    expect(adder.get()).toMatchObject({ phase: "cancelled" });
  });
});
