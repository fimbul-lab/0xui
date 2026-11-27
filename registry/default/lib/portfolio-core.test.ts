import { describe, expect, it } from "vitest";
import { portfolioPhase, summarizePortfolio, normalizeBalances } from "./portfolio-core";
import { NATIVE_TOKEN_ADDRESS } from "./token-list";
import type { TokenInfo } from "./token-list";

const token = (n: number, symbol: string, name = symbol): TokenInfo => ({
  chainId: 1,
  address: `0x${n.toString(16).padStart(40, "0")}`,
  symbol,
  name,
  decimals: 0,
});
const eth: TokenInfo = {
  chainId: 1,
  address: NATIVE_TOKEN_ADDRESS,
  symbol: "ETH",
  name: "Ether",
  decimals: 18,
};

describe("summarizePortfolio", () => {
  it("values, sorts and hides spam, unpriced tokens and dust", () => {
    const uni = token(1, "UNI", "Uniswap");
    const spam = token(2, "UNI", "Visit uni-claim.com to claim");
    const meme = token(3, "MEME");
    const dust = token(4, "DUST");
    const big = token(5, "BIG");
    const tokens = [uni, spam, meme, dust, big];
    const summary = summarizePortfolio({
      tokens,
      chainId: 1,
      balances: normalizeBalances(
        Object.fromEntries(tokens.map((t) => [t.address.toUpperCase(), 10n])),
      ),
      prices: { UNI: 10, DUST: 0.01, BIG: 50 },
    });

    expect(summary.rows.map((r) => r.token.symbol)).toEqual(["BIG", "UNI"]);
    expect(summary.total).toBe(600);
    expect(Object.fromEntries(summary.hidden.map((r) => [r.token.address, r.hidden]))).toEqual({
      [spam.address]: "spam",
      [meme.address]: "unpriced",
      [dust.address]: "dust",
    });
  });

  it("keeps the list's metadata for holdings and hides unlisted ones", () => {
    const listed = token(1, "USDC", "USD Coin");
    const unlisted = token(2, "NEW");
    const holdings = [
      { token: { ...listed, name: "From indexer" }, balance: 5n },
      { token: unlisted, balance: 5n },
    ];
    const input = {
      tokens: [listed],
      chainId: 1,
      balances: new Map(),
      holdings,
      prices: { USDC: 1, NEW: 1 },
    };

    const hidden = summarizePortfolio(input);
    expect(hidden.rows[0]!.token.name).toBe("USD Coin");
    expect(hidden.hidden[0]).toMatchObject({ unlisted: true, hidden: "unlisted" });
    expect(summarizePortfolio({ ...input, showUnlisted: true }).rows).toHaveLength(2);
  });

  it("always shows the native currency and counts unpriced rows", () => {
    const summary = summarizePortfolio({
      tokens: [eth],
      chainId: 1,
      balances: new Map([[eth.address.toLowerCase(), 1n]]),
    });
    expect(summary).toMatchObject({ total: 0, unpriced: 1 });
    expect(summary.rows).toHaveLength(1);
  });
});

describe("portfolioPhase", () => {
  const base = { loadingProp: false, hasSource: true, isLoading: false, isError: false, count: 1 };
  it("orders phases", () => {
    expect(portfolioPhase({ ...base, loadingProp: true, hasSource: false })).toBe("loading");
    expect(portfolioPhase({ ...base, hasSource: false })).toBe("idle");
    expect(portfolioPhase({ ...base, isLoading: true })).toBe("loading");
    expect(portfolioPhase({ ...base, isError: true })).toBe("error");
    expect(portfolioPhase({ ...base, count: 0 })).toBe("empty");
    expect(portfolioPhase(base)).toBe("ready");
  });
});
