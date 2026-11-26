import { parseEther, parseUnits } from "viem";
import { describe, expect, it } from "vitest";
import {
  formatRate,
  isSameToken,
  priceImpactLevel,
  swapBlocker,
  swapConfirmText,
  swapNeedsApproval,
  swapQuoteQueryOptions,
} from "./swap-core";
import type { GetQuote, SwapQuote } from "./swap-core";
import { NATIVE_TOKEN_ADDRESS } from "./token-list";
import type { TokenInfo } from "./token-list";

const eth: TokenInfo = {
  chainId: 1,
  address: NATIVE_TOKEN_ADDRESS,
  symbol: "ETH",
  name: "Ether",
  decimals: 18,
};
const usdc: TokenInfo = {
  chainId: 1,
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
};
const quote: SwapQuote = {
  buyAmount: parseUnits("6300", 6),
  transaction: { to: usdc.address },
  spender: usdc.address,
};

describe("swap", () => {
  it("formats the rate", () => {
    expect(
      formatRate(
        { token: eth, amount: parseEther("2") },
        { token: usdc, amount: quote.buyAmount },
        { locale: "en-US" },
      ),
    ).toBe("1 ETH = 3,150 USDC");
    expect(formatRate({ token: eth, amount: 0n }, { token: usdc, amount: 1n })).toBeUndefined();
  });

  it("quotes only a complete swap", async () => {
    const requests: Array<Parameters<GetQuote>[0]> = [];
    const getQuote: GetQuote = async (request) => {
      requests.push(request);
      return quote;
    };
    const options = swapQuoteQueryOptions({
      getQuote,
      sellToken: eth,
      buyToken: usdc,
      sellAmount: 2n,
      taker: undefined,
    });
    expect(options.enabled).toBe(true);
    expect(options.queryKey).toContain("2");
    expect(await options.queryFn()).toBe(quote);
    expect(requests).toEqual([
      {
        sellToken: eth,
        buyToken: usdc,
        sellAmount: 2n,
        taker: undefined,
      },
    ]);
    expect(
      swapQuoteQueryOptions({
        getQuote,
        sellToken: eth,
        buyToken: usdc,
        sellAmount: 0n,
        taker: undefined,
      }).enabled,
    ).toBe(false);
  });

  it("names what's missing, in order", () => {
    const ready = {
      sellToken: eth,
      buyToken: usdc,
      sellAmount: 1n,
      insufficient: false,
      error: null,
      quoting: false,
      quote,
    };
    expect(swapBlocker({ ...ready, buyToken: undefined })).toBe("Select a token");
    expect(swapBlocker({ ...ready, sellAmount: undefined })).toBe("Enter an amount");
    expect(swapBlocker({ ...ready, insufficient: true })).toBe("Insufficient ETH balance");
    expect(swapBlocker({ ...ready, error: new Error("x") })).toBe("No route found");
    expect(swapBlocker({ ...ready, quoting: true })).toBe("Fetching quote…");
    expect(swapBlocker(ready)).toBeUndefined();
  });

  it("asks for approval only for ERC-20s with a spender", () => {
    expect(swapNeedsApproval(usdc, quote)).toBe(true);
    expect(swapNeedsApproval(eth, quote)).toBe(false);
    expect(swapNeedsApproval(usdc, { ...quote, spender: undefined })).toBe(false);
    expect(isSameToken(eth, { ...eth })).toBe(true);
    expect(priceImpactLevel(6)).toBe("warn");
  });
});

describe("swapConfirmText", () => {
  it("names what leaves, about what arrives, the network and the price impact", () => {
    expect(
      swapConfirmText({
        sell: { token: eth, amount: parseEther("2") },
        buy: { token: usdc, amount: parseUnits("6300.5", 6) },
        priceImpact: 1.234,
        chainName: "Ethereum",
      }),
    ).toBe("Swaps 2 ETH from your wallet for about 6300.5 USDC on Ethereum (price impact 1.23%)");
    expect(
      swapConfirmText({ sell: { token: usdc, amount: 1n }, buy: { token: eth, amount: 1n } }),
    ).toBe("Swaps 0.000001 USDC from your wallet for about 0.000000000000000001 ETH");
  });
});
