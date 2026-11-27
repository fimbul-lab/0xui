// Locale pinned so the server and the browser format numbers the same way.
import { DepthChart } from "@/components/depth-chart";
import { demoPool, demoToken0, demoToken1 } from "./lp-pool";
import { demo } from "./demo";
import { usePretendLoad } from "./use-pretend-load";

const { bins, price } = demoPool;

export const Default = demo(() => {
  const loaded = usePretendLoad();
  return (
    <div className="w-full max-w-xl">
      <DepthChart
        locale="en-US"
        bins={loaded ? bins : undefined}
        currentPrice={loaded ? price : undefined}
        token0={demoToken0}
        token1={demoToken1}
      />
    </div>
  );
});

export const Inverted = demo(() => (
  <div className="w-full max-w-xl">
    <DepthChart
      locale="en-US"
      bins={bins}
      currentPrice={price}
      token0={demoToken0}
      token1={demoToken1}
      invert
      level={1}
    />
  </div>
));
