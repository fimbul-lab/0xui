import { describe, expect, it } from "vitest";
import type { TokenInfo } from "@/lib/token-list";
import { getDependentAmount, getSqrtRatioAtTick, priceToTick, rangeAroundTick, usableTickBounds } from "@/lib/concentrated-liquidity";
import {
  addLiquidityBlocker,
  addLiquidityConfirmText,
  getDepositAmounts,
  isSideLocked,
  mintRequest,
  mintTransactionQueryOptions,
  shortToken,
} from "@/lib/add-liquidity-core";
import { withSlippage } from "@/lib/v3-position-manager";

const usdc: TokenInfo = { chainId: 1, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", name: "USD Coin", symbol: "USDC", decimals: 6 };
const eth: TokenInfo = { chainId: 1, address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", name: "Ether", symbol: "ETH", decimals: 18 };
const me = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const tick = priceToTick(1 / 3000, 6, 18);
const pool = { tick, sqrtPriceX96: getSqrtRatioAtTick(tick), tickSpacing: 10, decimals0: 6, decimals1: 18 };
const range = rangeAroundTick(tick, 10, 10);

describe("getDepositAmounts", () => {
  it("fills the other side at the range's ratio", () => {
    const deposit = getDepositAmounts({ pool, range, token0: usdc, token1: eth, typed: { side: "token1", text: "1" } });
    const expected = getDependentAmount({ sqrtPriceX96: pool.sqrtPriceX96, ...range, amount: 10n ** 18n, token: "token1" })!;
    expect(deposit).toMatchObject({ mode: "both", amount0: expected, amount1: 10n ** 18n });
    expect(deposit.text.token1).toBe("1");
  });

  it("drops a typed side the range no longer takes", () => {
    const above = { tickLower: tick + 100, tickUpper: tick + 500 };
    const deposit = getDepositAmounts({ pool, range: above, token0: usdc, token1: eth, typed: { side: "token1", text: "1" } });
    expect(deposit.mode).toBe("token0");
    expect(isSideLocked(deposit.mode, "token1")).toBe(true);
    expect(deposit).toMatchObject({ amount0: 0n, amount1: 0n, text: { token0: "", token1: "" } });
  });
});

describe("mint", () => {
  it("builds the request with slippage floors, and waits for an account and an amount", () => {
    const request = mintRequest({ token0: usdc, token1: eth, fee: 500, range, amount0: 3000n, amount1: 1000n, slippageBps: 50, recipient: me });
    expect(request).toMatchObject({ amount0Min: withSlippage(3000n, 50), amount1Min: withSlippage(1000n, 50), deadline: 0n });
    expect(mintRequest({ token0: usdc, token1: eth, range, amount0: 1n, amount1: 0n, slippageBps: 50, recipient: undefined })).toBeUndefined();
    expect(mintRequest({ token0: usdc, token1: eth, range, amount0: 0n, amount1: 0n, slippageBps: 50, recipient: me })).toBeUndefined();
  });

  it("builds the transaction with a fresh deadline", async () => {
    const request = mintRequest({ token0: usdc, token1: eth, fee: 500, range, amount0: 1n, amount1: 1n, slippageBps: 50, recipient: me })!;
    let deadline = 0n;
    const options = mintTransactionQueryOptions({
      getTransaction: (r) => {
        deadline = r.deadline;
        return { to: me };
      },
      request,
      deadlineSeconds: 600,
    });
    expect(options.enabled).toBe(true);
    expect(options.refetchInterval).toBe(300_000);
    await options.queryFn();
    expect(Number(deadline)).toBeGreaterThan(Date.now() / 1000 + 590);
    expect(mintTransactionQueryOptions({ getTransaction: () => ({ to: me }), request: undefined, deadlineSeconds: 600 }).enabled).toBe(false);
  });
});

describe("addLiquidityBlocker", () => {
  it("names what's missing, in order", () => {
    const base = { connected: true, amount0: 1n, amount1: 1n, failed: false, ready: true };
    expect(addLiquidityBlocker({ ...base, connected: false, amount0: 0n, amount1: 0n })).toBeUndefined();
    expect(addLiquidityBlocker({ ...base, amount0: 0n, amount1: 0n })).toBe("Enter an amount");
    expect(addLiquidityBlocker({ ...base, short: usdc })).toBe("Insufficient USDC balance");
    expect(addLiquidityBlocker({ ...base, failed: true })).toBe("Can't build transaction");
    expect(addLiquidityBlocker({ ...base, ready: false })).toBe("Preparing…");
    expect(addLiquidityBlocker(base)).toBeUndefined();
  });

  it("finds the side the balance can't cover", () => {
    expect(shortToken([usdc, 5n, 4n], [eth, 1n, 1n])).toBe(usdc);
    expect(shortToken([usdc, 5n, undefined], [eth, 2n, 1n])).toBe(eth);
    expect(shortToken([usdc, 5n, 5n], [eth, 1n, undefined])).toBeUndefined();
  });
});

describe("addLiquidityConfirmText", () => {
  it("states the deposit, the range and the network", () => {
    const text = addLiquidityConfirmText({
      amount0: 3_000_000_000n,
      amount1: 10n ** 18n,
      token0: usdc,
      token1: eth,
      range,
      pool,
      invert: true,
      chainName: "Ethereum",
      locale: "en-US",
    });
    expect(text).toMatch(/^Deposits 3000 USDC and 1 ETH from your wallet as liquidity between 2,7\d\d.* and 3,3\d\d.* USDC per ETH on Ethereum$/);
    const { min, max } = usableTickBounds(10);
    expect(
      addLiquidityConfirmText({ amount0: 0n, amount1: 1n, token0: usdc, token1: eth, range: { tickLower: min, tickUpper: max }, pool }),
    ).toBe("Deposits 0.000000000000000001 ETH from your wallet as liquidity over the full price range");
  });
});
