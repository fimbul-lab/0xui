import { QueryClient } from "@tanstack/query-core";
import { maxUint256, parseUnits, type Address } from "viem";
import { describe, expect, it } from "vitest";
import { createTestConfig, erc20CallRpc, testAccounts } from "../../../test/wagmi";
import { allowanceQueryOptions, nextApproval } from "./approve-button-core";

const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
const usdt = "0xdAC17F958D2ee523a2206206994597C13D831ec7" as Address;
const router = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af" as Address;

describe("allowanceQueryOptions", () => {
  it("reads the allowance through query-core", async () => {
    const config = createTestConfig({
      rpc: { eth_call: erc20CallRpc({ allowance: parseUnits("5", 6) }) },
    });
    const options = allowanceQueryOptions(config, {
      token: usdc,
      spender: router,
      owner: testAccounts[0],
      chainId: 1,
    });
    expect(await new QueryClient().fetchQuery(options)).toBe(parseUnits("5", 6));
  });

  it("waits for an owner", () => {
    const options = allowanceQueryOptions(createTestConfig(), { token: usdc, spender: router });
    expect(options.enabled).toBe(false);
  });
});

describe("nextApproval", () => {
  const base = { amount: parseUnits("50", 6), chainId: 1, token: usdc };

  it("needs nothing once the allowance covers the amount", () => {
    expect(nextApproval({ ...base, allowance: parseUnits("50", 6) })).toEqual({ kind: "none" });
    expect(nextApproval({ ...base, amount: 0n, allowance: undefined })).toEqual({ kind: "none" });
  });

  it("approves the amount, or the maximum", () => {
    expect(nextApproval({ ...base, allowance: 0n })).toEqual({ kind: "approve", value: base.amount });
    expect(nextApproval({ ...base, allowance: 0n, unlimited: true })).toEqual({
      kind: "approve",
      value: maxUint256,
    });
  });

  it("resets a leftover USDT allowance first", () => {
    const usdtBase = { ...base, token: usdt };
    expect(nextApproval({ ...usdtBase, allowance: 1n })).toEqual({ kind: "reset", value: 0n });
    expect(nextApproval({ ...usdtBase, allowance: 0n }).kind).toBe("approve");
    expect(nextApproval({ ...base, allowance: 1n, resetFirst: true }).kind).toBe("reset");
  });
});
