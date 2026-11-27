// Locale pinned so the server and the browser format numbers the same way.
import { useState } from "react";
import { AddLiquidity, v3Mint } from "@/components/add-liquidity";
import { ConnectWallet } from "@/components/connect-wallet";
import { defaultFeeTiers } from "@/components/fee-tier-select";
import type { FeeTier } from "@/components/fee-tier-select";
import { createDemoPool, demoUsdcEthPool } from "./lp-pool";
import { demoEth, demoUsdc } from "./tokens";
import { demoPrices } from "./prices";
import { demo } from "./demo";
import { usePretendLoad } from "./use-pretend-load";

// Uniswap v3's NonfungiblePositionManager and WETH on Ethereum. Demo mints are never broadcast.
const positionManager = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const getTransaction = v3Mint({ positionManager, weth });

// Made-up USDC/WETH pools for two tiers. USDC sorts first, so it's token0.
const pools = {
  500: demoUsdcEthPool,
  3000: createDemoPool({ price: 1 / 3150, decimals0: 6, decimals1: 18, tickSpacing: 60, seed: 11 }),
};
const isPoolFee = (fee: number): fee is keyof typeof pools => fee in pools;
const tiers: Array<FeeTier> = defaultFeeTiers
  .filter((tier) => isPoolFee(tier.fee))
  .map((tier) => ({ ...tier, share: tier.fee === 500 ? 0.74 : 0.26 }));

export const Default = demo(() => {
  const [fee, setFee] = useState<keyof typeof pools>(500);
  const loaded = usePretendLoad();
  const { pool, bins } = pools[fee];
  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-2">
      <AddLiquidity
        locale="en-US"
        token0={demoUsdc}
        token1={demoEth}
        pool={loaded ? pool : undefined}
        bins={loaded ? bins : undefined}
        fee={fee}
        feeTiers={tiers}
        onFeeChange={(tier) => {
          if (isPoolFee(tier.fee)) {
            setFee(tier.fee);
          }
        }}
        getTransaction={getTransaction}
        spender={positionManager}
        defaultInvert
        prices={demoPrices}
      />
      <ConnectWallet variant="link" size="sm">
        Connect the Demo Wallet to use it
      </ConnectWallet>
    </div>
  );
});

export const SingleSided = demo(() => {
  const { pool, bins } = demoUsdcEthPool;
  // Inverted, ETH up 5–15%: ticks below the price, so the range takes only ETH (token1).
  return (
    <div className="w-full max-w-xl">
      <AddLiquidity
        locale="en-US"
        token0={demoUsdc}
        token1={demoEth}
        pool={pool}
        bins={bins}
        fee={500}
        defaultRange={{ tickLower: pool.tick - 1400, tickUpper: pool.tick - 490 }}
        getTransaction={getTransaction}
        spender={positionManager}
        defaultInvert
        prices={demoPrices}
        title="Sell ETH as it rises"
      />
    </div>
  );
});
