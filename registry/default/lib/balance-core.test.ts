import { describe, expect, it } from "vitest";
import { createTestConfig, erc20CallRpc, testAccounts } from "../../../test/wagmi";
import { balancePhase, tokenBalanceQueryOptions } from "./balance-core";

const address = testAccounts[0];

async function read(options: ReturnType<typeof tokenBalanceQueryOptions>) {
  return options.select(await options.queryFn({ queryKey: options.queryKey }));
}

describe("tokenBalanceQueryOptions", () => {
  it("reads a native balance", async () => {
    const config = createTestConfig({ rpc: { eth_getBalance: "0xde0b6b3a7640000" } });
    const options = tokenBalanceQueryOptions(config, { address, chainId: 1 });

    expect(options.enabled).toBe(true);
    expect(await read(options)).toEqual({ value: 10n ** 18n, decimals: 18, symbol: "ETH" });
  });

  it("reads an ERC-20 balance with its decimals and symbol", async () => {
    const config = createTestConfig({
      rpc: { eth_call: erc20CallRpc({ balance: 5_000_000n, decimals: 6, symbol: "USDC" }) },
    });
    const options = tokenBalanceQueryOptions(config, {
      address,
      token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      chainId: 1,
    });

    expect(await read(options)).toEqual({ value: 5_000_000n, decimals: 6, symbol: "USDC" });
  });

  it("stays off without an address", () => {
    const config = createTestConfig();
    expect(tokenBalanceQueryOptions(config, {}).enabled).toBe(false);
    expect(tokenBalanceQueryOptions(config, { address, enabled: false }).enabled).toBe(false);
  });
});

describe("balancePhase", () => {
  it("is idle without an address, then loading, ready or error", () => {
    expect(balancePhase({ address: undefined, isError: false, hasData: false })).toBe("idle");
    expect(balancePhase({ address, isError: false, hasData: false })).toBe("loading");
    expect(balancePhase({ address, isError: false, hasData: true })).toBe("ready");
    expect(balancePhase({ address, isError: true, hasData: false })).toBe("error");
  });
});
