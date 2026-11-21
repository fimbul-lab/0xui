import { PositionCard } from "@/components/position-card";
import { Button } from "@/components/ui/button";
import { v3Collect } from "@/lib/v3-position-manager";
import { demoUsdcEthPool } from "./lp-pool";
import { closedPosition, inRangePosition, outOfRangePosition, positionManager, weth } from "./lp-positions";
import { demoPrices } from "./prices";
import { demo } from "./demo";

const { pool } = demoUsdcEthPool;
const collect = v3Collect({ positionManager, weth });

export const Default = demo(() => (
  <div className="w-full max-w-md">
    <PositionCard
      position={inRangePosition}
      pool={pool}
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
));

export const States = demo(() => (
  <div className="grid w-full max-w-4xl gap-3 md:grid-cols-2">
    <PositionCard position={outOfRangePosition} pool={pool} prices={demoPrices} invert getCollectTransaction={collect} />
    <PositionCard position={closedPosition} pool={pool} prices={demoPrices} invert />
  </div>
));
