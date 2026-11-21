import {
  getLiquidityBins,
  priceToTick,
  ticksFromPositions,
  tickToPrice,
  usableTickBounds,
  type PoolState,
} from "@/lib/concentrated-liquidity";

/** Same seed, same pool: demos and screenshots stay stable. */
function random(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand: () => number) {
  return Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
}

export const demoToken0 = { symbol: "ETH", decimals: 18 };
export const demoToken1 = { symbol: "USDC", decimals: 6 };

/**
 * A made-up ETH/USDC 0.05% pool around 3,150 USDC: a few hundred positions,
 * most of them narrow around the price, some wide, a couple of full-range
 * ones, and two "walls" where a big LP parked liquidity.
 */
export function createDemoPool({
  price = 3150,
  tickSpacing = 10,
  seed = 7,
}: { price?: number; tickSpacing?: number; seed?: number } = {}) {
  const rand = random(seed);
  const { decimals: d0 } = demoToken0;
  const { decimals: d1 } = demoToken1;
  const tick = priceToTick(price, d0, d1) + 3;
  const snap = (t: number) => Math.round(t / tickSpacing) * tickSpacing;
  const positions: { tickLower: number; tickUpper: number; liquidity: bigint }[] = [];

  for (let i = 0; i < 420; i++) {
    const center = tick + normal(rand) * 900;
    const half = Math.max(tickSpacing, Math.exp(4 + rand() * 3.6));
    const tickLower = snap(center - half);
    const tickUpper = Math.max(tickLower + tickSpacing, snap(center + half));
    // Narrow positions hold less capital but more liquidity per tick.
    const liquidity = BigInt(Math.round((2e16 + rand() * 6e16) * (900 / (half + 300))));
    positions.push({ tickLower, tickUpper, liquidity });
  }
  // Walls: a bid wall near −6% and an ask wall near +9%.
  const wall = (p: number, width: number, liquidity: number) => {
    const t = snap(priceToTick(p, d0, d1));
    positions.push({ tickLower: t - width, tickUpper: t + width, liquidity: BigInt(liquidity) });
  };
  wall(price * 0.94, 60, 6e18);
  wall(price * 1.09, 80, 4.5e18);
  const { min, max } = usableTickBounds(tickSpacing);
  positions.push({ tickLower: min, tickUpper: max, liquidity: 40_000_000_000_000_000n });

  const { ticks, liquidity } = ticksFromPositions(positions, tick);
  const pool: PoolState = { tick, liquidity, tickSpacing, decimals0: d0, decimals1: d1 };
  return {
    pool,
    ticks,
    price: tickToPrice(tick, d0, d1),
    /** ±~35% at the pool's spacing. */
    bins: getLiquidityBins(pool, ticks, { bins: 300 }),
  };
}

export const demoPool = createDemoPool();
