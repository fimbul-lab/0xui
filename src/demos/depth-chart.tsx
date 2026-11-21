import { DepthChart } from "@/components/depth-chart";
import { demoPool, demoToken0, demoToken1 } from "./lp-pool";
import { demo } from "./demo";

const { bins, price } = demoPool;

export const Default = demo(() => (
  <div className="w-full max-w-xl">
    <DepthChart bins={bins} currentPrice={price} token0={demoToken0} token1={demoToken1} />
  </div>
));

export const Inverted = demo(() => (
  <div className="w-full max-w-xl">
    <DepthChart bins={bins} currentPrice={price} token0={demoToken0} token1={demoToken1} invert level={1} />
  </div>
));
