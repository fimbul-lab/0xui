import { RangeIndicator } from "@/components/range-indicator";
import { priceToTick } from "@/lib/concentrated-liquidity";

const pool = { tick: priceToTick(3150, 18, 6), tickSpacing: 10, decimals0: 18, decimals1: 6 };
const ETH = { symbol: "ETH" };
const USDC = { symbol: "USDC" };

export default function RangeIndicatorDemo() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <RangeIndicator tickLower={pool.tick - 800} tickUpper={pool.tick + 1200} pool={pool} token0={ETH} token1={USDC} />
      <RangeIndicator tickLower={pool.tick + 400} tickUpper={pool.tick + 1500} pool={pool} token0={ETH} token1={USDC} />
    </div>
  );
}
