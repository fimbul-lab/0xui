import { describe, expect, it } from "vitest";
import type { TokenInfo } from "@/lib/token-list";
import { getPositionAmounts, getSqrtRatioAtTick } from "@/lib/concentrated-liquidity";
import { formatMoney, formatPair, positionValue } from "@/lib/liquidity-utils";
import { collectConfirmText } from "@/lib/position-card-core";
import {
  getRemoveAmounts,
  removeBlocker,
  removeConfirmText,
  removeRequest,
} from "@/lib/remove-liquidity-core";
import { withSlippage } from "@/lib/v3-position-manager";

const usdc: TokenInfo = {
  chainId: 1,
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  name: "USD Coin",
  symbol: "USDC",
  decimals: 6,
};
const eth: TokenInfo = {
  chainId: 1,
  address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  name: "Ether",
  symbol: "ETH",
  decimals: 18,
};
const me = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const tick = 195_770;
const pool = { tick, sqrtPriceX96: getSqrtRatioAtTick(tick) };
const position = {
  tokenId: 7n,
  token0: usdc,
  token1: eth,
  fee: 500,
  tickLower: tick - 960,
  tickUpper: tick + 1060,
  liquidity: 10n ** 15n,
  fees0: 18_420_000n,
  fees1: 5_700_000_000_000_000n,
};

describe("remove-liquidity-core", () => {
  it("removes a share of the liquidity and keeps all fees", () => {
    const half = getRemoveAmounts(position, pool, 50, 50);
    const all = getPositionAmounts(position, pool);
    expect(half.liquidity).toBe(position.liquidity / 2n);
    expect(Number(half.amount0) / Number(all.amount0)).toBeCloseTo(0.5, 6);
    expect(half.amount1Min).toBe(withSlippage(half.amount1, 50));
    expect(half.fees0).toBe(position.fees0);
  });

  it("names why nothing can be removed", () => {
    expect(removeBlocker({ liquidity: 0n }, 50)).toBe("Position is closed");
    expect(removeBlocker(position, 0)).toBe("Select an amount");
    expect(removeBlocker(position, 25)).toBeUndefined();
  });

  it("builds the request and the confirm text from the same amounts", () => {
    const amounts = getRemoveAmounts(position, pool, 100, 50);
    expect(removeRequest({ position, amounts, recipient: me, deadline: 9n })).toEqual({
      tokenId: 7n,
      token0: usdc,
      token1: eth,
      liquidity: position.liquidity,
      amount0Min: amounts.amount0Min,
      amount1Min: amounts.amount1Min,
      recipient: me,
      deadline: 9n,
    });
    expect(
      removeConfirmText({
        tokenId: 7n,
        percent: 100,
        amounts,
        token0: usdc,
        token1: eth,
        chainName: "Ethereum",
      }),
    ).toMatch(
      /^Removes 100% of position #7 on Ethereum: at least .+ back, plus 18\.42 USDC and 0\.0057 ETH in fees, to your wallet$/,
    );
  });
});

describe("position-card-core", () => {
  it("values a position when both prices are known", () => {
    expect(
      positionValue({ amount0: 18_420_000n, amount1: 5_700_000_000_000_000n }, usdc, eth, {
        USDC: 1,
        ETH: 3150,
      }),
    ).toBeCloseTo(36.375);
    expect(positionValue({ amount0: 1n, amount1: 1n }, usdc, eth, { USDC: 1 })).toBeUndefined();
    expect(formatMoney(36.375, "USD", "en-US")).toBe("$36.38");
  });

  it("states exact fees for Collect", () => {
    expect(formatPair(0n, 0n, usdc, eth)).toBe("nothing");
    expect(
      collectConfirmText({ tokenId: 7n, fees0: 18_420_000n, fees1: 0n, token0: usdc, token1: eth }),
    ).toBe("Collects the fees of position #7: 18.42 USDC, to your wallet");
  });
});
