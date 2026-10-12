import { QueryClient } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { mainnet } from "viem/chains";
import { describe, expect, it } from "vitest";
import { Web3Provider } from "@/components/web3-provider";
import { createTestConfig } from "../../../test/wagmi";
import { useTokenList } from "../hooks/use-token-list";
import {
  NATIVE_TOKEN_ADDRESS,
  applyTokenFilters,
  isNativeToken,
  mergeTokenLists,
  nativeToken,
  parseTokenList,
} from "./token-list";

const usdc = {
  chainId: 1,
  address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  name: "USDCoin",
  symbol: "USDC",
  decimals: 6,
  logoURI: "ipfs://QmUSDC",
  extensions: { bridgeInfo: { "8453": { tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" } } },
};
const baseUsdc = { ...usdc, chainId: 8453, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" };
const solana = { chainId: 501000101, address: "5mbK36SZ7J19An8jFochhQS4of8g6BwUjbeCSxBSoWdp", name: "michi", symbol: "$MICHI", decimals: 6 };

const list = (tokens: unknown[], name = "Test List") => ({
  name,
  timestamp: "2026-10-08T17:54:32.750Z",
  version: { major: 1, minor: 0, patch: 0 },
  tokens,
});

describe("parseTokenList", () => {
  it("keeps valid EVM tokens, checksummed, with extensions", () => {
    const parsed = parseTokenList(list([usdc, baseUsdc, solana, { symbol: "BAD" }]));
    expect(parsed.tokens).toHaveLength(2);
    expect(parsed.tokens[0]!.address).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
    expect(parsed.tokens[0]!.extensions?.bridgeInfo?.["8453"]?.tokenAddress).toBe(baseUsdc.address);
    expect(parsed.version.major).toBe(1);
  });

  it("rejects things that aren't token lists", () => {
    expect(() => parseTokenList({ tokens: "nope" })).toThrow("Not a token list");
    expect(() => parseTokenList(null)).toThrow("Not a token list");
  });
});

describe("helpers", () => {
  it("builds the native token from a chain", () => {
    expect(nativeToken(mainnet)).toEqual({
      chainId: 1,
      address: NATIVE_TOKEN_ADDRESS,
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
      logoURI: undefined,
    });
    expect(isNativeToken({ address: NATIVE_TOKEN_ADDRESS.toLowerCase() as `0x${string}` })).toBe(true);
  });

  it("merges lists with the first list winning", () => {
    const a = parseTokenList(list([usdc]));
    const b = parseTokenList(list([{ ...usdc, name: "Other name" }, baseUsdc]));
    const merged = mergeTokenLists([a, b]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.name).toBe("USDCoin");
  });
});

describe("applyTokenFilters", () => {
  const tokens = parseTokenList(list([usdc, baseUsdc])).tokens;

  it("keeps only allowlisted addresses, on any chain or a pinned one", () => {
    expect(applyTokenFilters(tokens, { allowlist: [usdc.address] }).map((t) => t.chainId)).toEqual([1]);
    expect(
      applyTokenFilters(tokens, { allowlist: [`8453:${baseUsdc.address.toLowerCase()}`] }).map((t) => t.chainId)
    ).toEqual([8453]);
  });

  it("drops blocklisted tokens, even when allowlisted", () => {
    expect(applyTokenFilters(tokens, { blocklist: [baseUsdc.address] })).toHaveLength(1);
    expect(applyTokenFilters(tokens, { allowlist: [usdc.address], blocklist: [usdc.address] })).toHaveLength(0);
  });
});

describe("useTokenList", () => {
  const dataUrl = (json: unknown) =>
    `data:application/json;base64,${Buffer.from(JSON.stringify(json)).toString("base64")}`;

  function wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <Web3Provider config={createTestConfig()} queryClient={queryClient}>
        {children}
      </Web3Provider>
    );
  }

  it("loads a list, filters to the chain, and adds the native currency", async () => {
    const { result } = renderHook(() => useTokenList(dataUrl(list([usdc, baseUsdc, solana]))), { wrapper });
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.tokens.map((t) => t.symbol)).toEqual(["ETH", "USDC"]);
    expect(result.current.lists[0]!.name).toBe("Test List");
  });

  it("merges several lists and extra tokens", async () => {
    const extra = parseTokenList(list([{ ...usdc, name: "My USDC" }])).tokens;
    const { result } = renderHook(
      () =>
        useTokenList([dataUrl(list([usdc])), dataUrl(list([baseUsdc], "Base"))], {
          chainId: null,
          includeNative: false,
          extraTokens: extra,
        }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.lists).toHaveLength(2));
    expect(result.current.tokens.map((t) => `${t.chainId}:${t.name}`)).toEqual(["1:My USDC", "8453:USDCoin"]);
  });

  it("applies an allowlist but keeps the native currency", async () => {
    const { result } = renderHook(
      () => useTokenList(dataUrl(list([usdc, { ...usdc, address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT" }])), {
        allowlist: [usdc.address],
      }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.tokens.map((t) => t.symbol)).toEqual(["ETH", "USDC"]);
  });

  it("reports a broken list", async () => {
    const { result } = renderHook(() => useTokenList(dataUrl({ hello: "world" })), { wrapper });
    // One retry before giving up.
    await waitFor(() => expect(result.current.error).toBeTruthy(), { timeout: 4_000 });
    expect(result.current.tokens).toEqual([expect.objectContaining({ symbol: "ETH" })]);
  });
});
