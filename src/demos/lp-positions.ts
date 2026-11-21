import type { Position } from "@/lib/concentrated-liquidity";
import type { TokenInfo } from "@/lib/token-list";
import { demoUsdcEthPool } from "./lp-pool";
import { demoEth, demoUsdc } from "./tokens";

const base = Math.floor(demoUsdcEthPool.pool.tick / 10) * 10;

/** Uniswap v3's position manager and WETH on Ethereum. Demo transactions are never broadcast. */
export const positionManager = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
export const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

/** About $5.5k, ±10% around 3,150 USDC per ETH, with some fees. */
export const inRangePosition: Position<TokenInfo> = {
  tokenId: 812_345n,
  token0: demoUsdc,
  token1: demoEth,
  fee: 500,
  tickLower: base - 960,
  tickUpper: base + 1060,
  liquidity: 10n ** 15n,
  fees0: 18_420_000n,
  fees1: 5_700_000_000_000_000n,
};

/** A range order above the price (in USDC per ETH): holds only ETH. */
export const outOfRangePosition: Position<TokenInfo> = {
  tokenId: 812_346n,
  token0: demoUsdc,
  token1: demoEth,
  fee: 500,
  tickLower: base - 1400,
  tickUpper: base - 490,
  liquidity: 6n * 10n ** 14n,
  fees0: 0n,
  fees1: 1_200_000_000_000_000n,
};

/** Everything withdrawn. */
export const closedPosition: Position<TokenInfo> = {
  tokenId: 790_112n,
  token0: demoUsdc,
  token1: demoEth,
  fee: 3000,
  tickLower: base - 3000,
  tickUpper: base + 3000,
  liquidity: 0n,
  fees0: 0n,
  fees1: 0n,
};
