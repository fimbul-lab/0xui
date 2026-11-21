// Locale pinned so the server and the browser format numbers the same way.
import { PositionList } from "@/components/position-list";
import { Button } from "@/components/ui/button";
import { v3Collect } from "@/lib/v3-position-manager";
import { demoUsdcEthPool } from "./lp-pool";
import { closedPosition, inRangePosition, outOfRangePosition, positionManager, weth } from "./lp-positions";
import { demoPrices } from "./prices";
import { demo } from "./demo";
import { usePretendLoad } from "./use-pretend-load";

const { pool } = demoUsdcEthPool;
const items = [closedPosition, outOfRangePosition, inRangePosition].map((position) => ({ position, pool }));

export const Default = demo(() => {
  const loaded = usePretendLoad();
  return (
    <div className="w-full max-w-md">
      <PositionList
        locale="en-US"
        positions={loaded ? items : undefined}
        prices={demoPrices}
        getCollectTransaction={v3Collect({ positionManager, weth })}
        actions={() => (
          <>
            <Button variant="outline">Add</Button>
            <Button variant="outline">Remove</Button>
          </>
        )}
      />
    </div>
  );
});

export const Empty = demo(() => (
  <div className="w-full max-w-md">
    <PositionList locale="en-US" positions={[]} empty={<Button>New position</Button>} />
  </div>
));
