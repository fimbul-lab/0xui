// Locale pinned so the server and the browser format numbers the same way.
import { ConnectWallet } from "@/components/connect-wallet";
import { RemoveLiquidity } from "@/components/remove-liquidity";
import { v3Remove } from "@/lib/v3-position-manager";
import { demoUsdcEthPool } from "./lp-pool";
import { inRangePosition, positionManager, weth } from "./lp-positions";
import { demoPrices } from "./prices";
import { demo } from "./demo";
import { usePretendLoad } from "./use-pretend-load";

export const Default = demo(() => {
  const loaded = usePretendLoad();
  return (
    <>
      <RemoveLiquidity locale="en-US"
        position={loaded ? inRangePosition : undefined}
        pool={loaded ? demoUsdcEthPool.pool : undefined}
        getTransaction={v3Remove({ positionManager, weth })}
        prices={demoPrices}
        invert
      />
      <ConnectWallet variant="link" size="sm">
        Connect the Demo Wallet to use it
      </ConnectWallet>
    </>
  );
});
