// Locale pinned so the server and the browser format numbers the same way.
import { PositionCard } from "@/components/position-card";
import { Button } from "@/components/primitives/button";
import { v3Collect } from "@/lib/v3-position-manager";
import { demoUsdcEthPool } from "./lp-pool";
import {
  closedPosition,
  inRangePosition,
  outOfRangePosition,
  positionManager,
  weth,
} from "./lp-positions";
import { demoPrices } from "./prices";
import { demo } from "./demo";
import { usePretendLoad } from "./use-pretend-load";

const { pool } = demoUsdcEthPool;
const collect = v3Collect({ positionManager, weth });

export const Default = demo(() => {
  const loaded = usePretendLoad();
  return (
    <div className="w-full max-w-md">
      <PositionCard locale="en-US"
        position={loaded ? inRangePosition : undefined}
        pool={loaded ? pool : undefined}
        prices={demoPrices}
        invert
        getCollectTransaction={collect}
        actions={
          <>
            <Button variant="outline">Add</Button>
            <Button variant="outline">Remove</Button>
          </>
        }
      />
    </div>
  );
});

export const States = demo(() => (
  <div className="grid w-full max-w-4xl gap-3 md:grid-cols-2">
    <PositionCard locale="en-US"
      position={outOfRangePosition}
      pool={pool}
      prices={demoPrices}
      invert
      getCollectTransaction={collect}
    />
    <PositionCard locale="en-US" position={closedPosition} pool={pool} prices={demoPrices} invert />
  </div>
));
