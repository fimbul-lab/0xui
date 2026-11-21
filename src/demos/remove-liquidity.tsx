import { ConnectWallet } from "@/components/connect-wallet";
import { RemoveLiquidity } from "@/components/remove-liquidity";
import { v3Remove } from "@/lib/v3-position-manager";
import { demoUsdcEthPool } from "./lp-pool";
import { inRangePosition, positionManager, weth } from "./lp-positions";
import { demoPrices } from "./prices";
import { demo } from "./demo";

export const Default = demo(() => (
  <>
    <RemoveLiquidity
      position={inRangePosition}
      pool={demoUsdcEthPool.pool}
      getTransaction={v3Remove({ positionManager, weth })}
      prices={demoPrices}
      invert
    />
    <ConnectWallet variant="link" size="sm">
      Connect the Demo Wallet to use it
    </ConnectWallet>
  </>
));
