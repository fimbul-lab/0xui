import { RemoveLiquidity } from "@/components/remove-liquidity";
import { getSqrtRatioAtTick } from "@/lib/concentrated-liquidity";
import { v3Remove } from "@/lib/v3-position-manager";

// USDC/WETH 0.05% on Ethereum. USDC sorts first, so it is token0.
const usdc = { chainId: 1, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", name: "USD Coin", symbol: "USDC", decimals: 6 } as const;
const eth = { chainId: 1, address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", name: "Ether", symbol: "ETH", decimals: 18 } as const;
const positionManager = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// Read these from the pool (slot0) and the position manager (positions, collect) instead.
const tick = 195770;
const pool = { tick, sqrtPriceX96: getSqrtRatioAtTick(tick), tickSpacing: 10, decimals0: 6, decimals1: 18 };
const position = {
  tokenId: 812345n,
  token0: usdc,
  token1: eth,
  fee: 500,
  tickLower: tick - 960,
  tickUpper: tick + 1060,
  liquidity: 10n ** 15n,
  fees0: 18_420_000n,
  fees1: 5_700_000_000_000_000n,
};
const prices = { USDC: 1, ETH: 3150 };

export default function RemoveLiquidityDemo() {
  return (
    <RemoveLiquidity
      position={position}
      pool={pool}
      getTransaction={v3Remove({ positionManager, weth })}
      prices={prices}
      invert
    />
  );
}
