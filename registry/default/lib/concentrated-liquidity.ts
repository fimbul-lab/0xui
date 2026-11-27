// Docs: https://0xui.io/components/liquidity-chart.md
//
// Concentrated liquidity math (Uniswap v3/v4 and forks: PancakeSwap v3,
// Aerodrome Slipstream, Sushi v3, Algebra-style pools with fixed spacing).
//
// Two kinds of math live here:
// - Exact bigint math (TickMath, LiquidityAmounts) for anything that ends up
//   in a transaction: deposit amounts, liquidity, sqrt prices.
// - Float math for display: prices on axes, bin heights, depth curves.
//
// Prices are always "token1 per token0" in human units unless a function
// says otherwise. Flip with `invert` at the edge (UI), never in the math.

export const MIN_TICK = -887_272;
export const MAX_TICK = 887_272;
export const MIN_SQRT_RATIO = 4_295_128_739n;
export const MAX_SQRT_RATIO = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n;
export const Q96 = 2n ** 96n;

const LOG_BASE = Math.log(1.0001);
const MAX_UINT256 = 2n ** 256n - 1n;

/** Common fee tiers in hundredths of a bip (500 = 0.05%) and their tick spacing. */
export const FEE_TIERS = [
  { fee: 100, tickSpacing: 1 },
  { fee: 500, tickSpacing: 10 },
  { fee: 3000, tickSpacing: 60 },
  { fee: 10_000, tickSpacing: 200 },
] as const;

/** Pool state the components need. Read it from the pool's `slot0` and `liquidity`, or your indexer. */
export type PoolState = {
  /** Current tick (`slot0.tick`). */
  tick: number;
  /** Exact current price (`slot0.sqrtPriceX96`). Needed for deposit amounts. */
  sqrtPriceX96?: bigint;
  /** Liquidity active at the current tick (`liquidity()`). */
  liquidity: bigint;
  tickSpacing: number;
  decimals0: number;
  decimals1: number;
};

/** An initialized tick, as returned by TickLens or a subgraph. */
export type TickData = {
  tick: number;
  /** Liquidity added (positive) or removed (negative) when the price crosses this tick upward. */
  liquidityNet: bigint;
};

/** One bar of the liquidity distribution: a tick-spacing-wide slice of the curve. */
export type LiquidityBin = {
  tickLower: number;
  tickUpper: number;
  /** Price at `tickLower`, token1 per token0. */
  priceLower: number;
  /** Price at `tickUpper`, token1 per token0. */
  priceUpper: number;
  /** Active liquidity in this slice. */
  liquidity: bigint;
  /** Token0 locked in the slice, in human units. Only slices above the price hold token0. */
  amount0: number;
  /** Token1 locked in the slice, in human units. Only slices below the price hold token1. */
  amount1: number;
  /** True for the slice the current price sits in. It holds both tokens. */
  isCurrent: boolean;
};

/* ------------------------------------------------------------------------ */
/* Ticks and prices (float, for display)                                    */
/* ------------------------------------------------------------------------ */

/** Human price of token0 in token1 at a tick. */
export function tickToPrice(tick: number, decimals0: number, decimals1: number) {
  return Math.pow(1.0001, tick) * Math.pow(10, decimals0 - decimals1);
}

/** The tick at or below a human price (token1 per token0). */
export function priceToTick(price: number, decimals0: number, decimals1: number) {
  if (!(price > 0)) {
    return MIN_TICK;
  }
  if (!Number.isFinite(price)) {
    return MAX_TICK;
  }
  const raw = price / Math.pow(10, decimals0 - decimals1);
  // Nudge by a hair so an exact tick price doesn't floor to the tick below.
  const tick = Math.floor(Math.log(raw) / LOG_BASE + 1e-9);
  return Math.min(MAX_TICK, Math.max(MIN_TICK, tick));
}

/** Lowest and highest tick a position can use with this spacing. */
export function usableTickBounds(tickSpacing: number) {
  return {
    min: Math.ceil(MIN_TICK / tickSpacing) * tickSpacing,
    max: Math.floor(MAX_TICK / tickSpacing) * tickSpacing,
  };
}

/** Round a tick to the nearest multiple of the spacing, inside the usable bounds. */
export function nearestUsableTick(tick: number, tickSpacing: number) {
  const { min, max } = usableTickBounds(tickSpacing);
  const rounded = Math.round(tick / tickSpacing) * tickSpacing;
  return Math.min(max, Math.max(min, rounded === 0 ? 0 : rounded));
}

/** Human price (token1 per token0) from `sqrtPriceX96`. */
export function sqrtPriceX96ToPrice(sqrtPriceX96: bigint, decimals0: number, decimals1: number) {
  const sqrt = Number(sqrtPriceX96) / 2 ** 96;
  return sqrt * sqrt * Math.pow(10, decimals0 - decimals1);
}

/** Current human price of a pool, exact when `sqrtPriceX96` is known. */
export function poolPrice(pool: PoolState) {
  return pool.sqrtPriceX96 !== undefined
    ? sqrtPriceX96ToPrice(pool.sqrtPriceX96, pool.decimals0, pool.decimals1)
    : tickToPrice(pool.tick, pool.decimals0, pool.decimals1);
}

/** True when the ticks are the full usable range for the spacing. */
export function isFullRange(tickLower: number, tickUpper: number, tickSpacing: number) {
  const { min, max } = usableTickBounds(tickSpacing);
  return tickLower <= min && tickUpper >= max;
}

/** Format a price for labels: 6 significant digits, compact above a billion, 0 and ∞ at the full-range ends. */
export function formatPrice(price: number, { locale }: { locale?: string } = {}) {
  if (!Number.isFinite(price)) {
    return "∞";
  }
  if (price === 0) {
    return "0";
  }
  const abs = Math.abs(price);
  if (abs < 1e-8 || abs >= 1e15) {
    return price.toExponential(3).replace("e+", "e");
  }
  return new Intl.NumberFormat(locale, {
    maximumSignificantDigits: abs >= 1e9 ? 4 : 6,
    notation: abs >= 1e9 ? "compact" : "standard",
  }).format(price);
}

/* ------------------------------------------------------------------------ */
/* Exact math (bigint), ported from Uniswap v3 TickMath and LiquidityAmounts */
/* ------------------------------------------------------------------------ */

const TICK_RATIOS: ReadonlyArray<readonly [number, bigint]> = [
  [0x2, 0xff_f9_72_72_37_3d_41_32_59_a4_69_90_58_0e_21_3an],
  [0x4, 0xff_f2_e5_0f_5f_65_69_32_ef_12_35_7c_f3_c7_fd_ccn],
  [0x8, 0xff_e5_ca_ca_7e_10_e4_e6_1c_36_24_ea_a0_94_1c_d0n],
  [0x10, 0xff_cb_98_43_d6_0f_61_59_c9_db_58_83_5c_92_66_44n],
  [0x20, 0xff_97_3b_41_fa_98_c0_81_47_2e_68_96_df_b2_54_c0n],
  [0x40, 0xff_2e_a1_64_66_c9_6a_38_43_ec_78_b3_26_b5_28_61n],
  [0x80, 0xfe_5d_ee_04_6a_99_a2_a8_11_c4_61_f1_96_9c_30_53n],
  [0x1_00, 0xfc_be_86_c7_90_0a_88_ae_dc_ff_c8_3b_47_9a_a3_a4n],
  [0x2_00, 0xf9_87_a7_25_3a_c4_13_17_6f_2b_07_4c_f7_81_5e_54n],
  [0x4_00, 0xf3_39_2b_08_22_b7_00_05_94_0c_7a_39_8e_4b_70_f3n],
  [0x8_00, 0xe7_15_94_75_a2_c2_9b_74_43_b2_9c_7f_a6_e8_89_d9n],
  [0x10_00, 0xd0_97_f3_bd_fd_20_22_b8_84_5a_d8_f7_92_aa_58_25n],
  [0x20_00, 0xa9_f7_46_46_2d_87_0f_df_8a_65_dc_1f_90_e0_61_e5n],
  [0x40_00, 0x70_d8_69_a1_56_d2_a1_b8_90_bb_3d_f6_2b_af_32_f7n],
  [0x80_00, 0x31_be_13_5f_97_d0_8f_d9_81_23_15_05_54_2f_cf_a6n],
  [0x1_00_00, 0x9_aa_50_8b_5b_7a_84_e1_c6_77_de_54_f3_e9_9b_c9n],
  [0x2_00_00, 0x5d_6a_f8_de_db_81_19_66_99_c3_29_22_5e_e6_04n],
  [0x4_00_00, 0x22_16_e5_84_f5_fa_1e_a9_26_04_1b_ed_fe_98n],
  [0x8_00_00, 0x4_8a_17_03_91_f7_dc_42_44_4e_8f_a2n],
];

/** Exact `sqrt(1.0001^tick) * 2^96`, the same value the pool contract uses. */
export function getSqrtRatioAtTick(tick: number) {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) {
    throw new RangeError(`Tick ${tick} is outside ${MIN_TICK}…${MAX_TICK}`);
  }
  const absTick = Math.abs(tick);
  let ratio =
    absTick & 0x1
      ? 0xff_fc_b9_33_bd_6f_ad_37_aa_2d_16_2d_1a_59_40_01n
      : 0x1_00_00_00_00_00_00_00_00_00_00_00_00_00_00_00_00n;
  for (const [bit, factor] of TICK_RATIOS) {
    if (absTick & bit) {
      ratio = (ratio * factor) >> 128n;
    }
  }
  if (tick > 0) {
    ratio = MAX_UINT256 / ratio;
  }
  // Q128.128 to Q64.96, rounding up.
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

function sorted(a: bigint, b: bigint): [bigint, bigint] {
  return a > b ? [b, a] : [a, b];
}

/** Token0 for `liquidity` between two sqrt prices, rounded down. */
export function getAmount0ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint) {
  const [lo, hi] = sorted(sqrtA, sqrtB);
  return ((liquidity << 96n) * (hi - lo)) / hi / lo;
}

/** Token1 for `liquidity` between two sqrt prices, rounded down. */
export function getAmount1ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint) {
  const [lo, hi] = sorted(sqrtA, sqrtB);
  return (liquidity * (hi - lo)) / Q96;
}

/** Liquidity bought by `amount0` between two sqrt prices. */
export function getLiquidityForAmount0(sqrtA: bigint, sqrtB: bigint, amount0: bigint) {
  const [lo, hi] = sorted(sqrtA, sqrtB);
  return (amount0 * ((lo * hi) / Q96)) / (hi - lo);
}

/** Liquidity bought by `amount1` between two sqrt prices. */
export function getLiquidityForAmount1(sqrtA: bigint, sqrtB: bigint, amount1: bigint) {
  const [lo, hi] = sorted(sqrtA, sqrtB);
  return (amount1 * Q96) / (hi - lo);
}

/** Token amounts a position of `liquidity` holds at the current price. */
export function getAmountsForLiquidity(
  sqrtPrice: bigint,
  sqrtA: bigint,
  sqrtB: bigint,
  liquidity: bigint,
) {
  const [lo, hi] = sorted(sqrtA, sqrtB);
  if (sqrtPrice <= lo) {
    return { amount0: getAmount0ForLiquidity(lo, hi, liquidity), amount1: 0n };
  }
  if (sqrtPrice >= hi) {
    return { amount0: 0n, amount1: getAmount1ForLiquidity(lo, hi, liquidity) };
  }
  return {
    amount0: getAmount0ForLiquidity(sqrtPrice, hi, liquidity),
    amount1: getAmount1ForLiquidity(lo, sqrtPrice, liquidity),
  };
}

/** Most liquidity the two amounts can buy at the current price (the smaller side wins). */
export function getLiquidityForAmounts(
  sqrtPrice: bigint,
  sqrtA: bigint,
  sqrtB: bigint,
  amount0: bigint,
  amount1: bigint,
) {
  const [lo, hi] = sorted(sqrtA, sqrtB);
  if (sqrtPrice <= lo) {
    return getLiquidityForAmount0(lo, hi, amount0);
  }
  if (sqrtPrice >= hi) {
    return getLiquidityForAmount1(lo, hi, amount1);
  }
  const l0 = getLiquidityForAmount0(sqrtPrice, hi, amount0);
  const l1 = getLiquidityForAmount1(lo, sqrtPrice, amount1);
  return l0 < l1 ? l0 : l1;
}

/* ------------------------------------------------------------------------ */
/* Ranges and deposits                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Which tokens a range takes at the current tick:
 * - `both`: the price is inside the range.
 * - `token0`: the range is above the price, so it only takes token0.
 * - `token1`: the range is below the price, so it only takes token1.
 */
export type DepositMode = "both" | "token0" | "token1";

export function getDepositMode(
  currentTick: number,
  tickLower: number,
  tickUpper: number,
): DepositMode {
  if (currentTick < tickLower) {
    return "token0";
  }
  if (currentTick >= tickUpper) {
    return "token1";
  }
  return "both";
}

/**
 * Where a position sits relative to the price.
 * `closed` means it has no liquidity left.
 */
export type RangeStatus = "in-range" | "out-of-range" | "closed";

export function getRangeStatus(
  currentTick: number,
  tickLower: number,
  tickUpper: number,
  liquidity?: bigint,
): RangeStatus {
  if (liquidity === 0n) {
    return "closed";
  }
  return currentTick >= tickLower && currentTick < tickUpper ? "in-range" : "out-of-range";
}

/**
 * The other token's amount for a two-sided deposit: type ETH, get the USDC
 * the range needs at the current price. Returns 0n when the range takes
 * only the token you typed, and `undefined` when it takes only the other one.
 */
export function getDependentAmount({
  sqrtPriceX96,
  tickLower,
  tickUpper,
  amount,
  token,
}: {
  sqrtPriceX96: bigint;
  tickLower: number;
  tickUpper: number;
  /** Amount of the token the user typed, in its smallest unit. */
  amount: bigint;
  /** Which token `amount` is. */
  token: "token0" | "token1";
}): bigint | undefined {
  const sqrtA = getSqrtRatioAtTick(tickLower);
  const sqrtB = getSqrtRatioAtTick(tickUpper);
  if (sqrtPriceX96 <= sqrtA) {
    return token === "token0" ? 0n : undefined;
  }
  if (sqrtPriceX96 >= sqrtB) {
    return token === "token1" ? 0n : undefined;
  }
  if (token === "token0") {
    const liquidity = getLiquidityForAmount0(sqrtPriceX96, sqrtB, amount);
    return getAmount1ForLiquidity(sqrtA, sqrtPriceX96, liquidity);
  }
  const liquidity = getLiquidityForAmount1(sqrtA, sqrtPriceX96, amount);
  return getAmount0ForLiquidity(sqrtPriceX96, sqrtB, liquidity);
}

/** Ticks for a range given in human prices, snapped to the spacing. Swaps them if min > max. */
export function priceRangeToTicks(
  minPrice: number,
  maxPrice: number,
  { tickSpacing, decimals0, decimals1 }: Pick<PoolState, "tickSpacing" | "decimals0" | "decimals1">,
) {
  const { min, max } = usableTickBounds(tickSpacing);
  const lo = Math.min(minPrice, maxPrice);
  const hi = Math.max(minPrice, maxPrice);
  let tickLower =
    lo <= 0 ? min : nearestUsableTick(priceToTick(lo, decimals0, decimals1), tickSpacing);
  let tickUpper = !Number.isFinite(hi)
    ? max
    : nearestUsableTick(priceToTick(hi, decimals0, decimals1), tickSpacing);
  if (tickUpper <= tickLower) {
    if (tickLower + tickSpacing <= max) {
      tickUpper = tickLower + tickSpacing;
    } else {
      tickLower = tickUpper - tickSpacing;
    }
  }
  return { tickLower, tickUpper };
}

/**
 * A range of ±`percent` around the current tick, snapped to the spacing and
 * at least one spacing wide on each side, in the price as displayed:
 * pass `invert` when prices are shown in token0 per token1.
 */
export function rangeAroundTick(
  currentTick: number,
  percent: number,
  tickSpacing: number,
  { invert = false }: { invert?: boolean } = {},
): TickRange {
  // Symmetric in the displayed price: mirror the ticks, build, mirror back.
  if (invert) {
    const r = rangeAroundTick(-currentTick, percent, tickSpacing);
    return { tickLower: -r.tickUpper || 0, tickUpper: -r.tickLower || 0 };
  }
  const { min, max } = usableTickBounds(tickSpacing);
  const up = Math.log(1 + percent / 100) / LOG_BASE;
  const down = Math.log(Math.max(1e-9, 1 - percent / 100)) / LOG_BASE;
  const base = Math.floor(currentTick / tickSpacing) * tickSpacing;
  let tickLower = Math.floor((currentTick + down) / tickSpacing) * tickSpacing;
  let tickUpper = Math.ceil((currentTick + up) / tickSpacing) * tickSpacing;
  tickLower = Math.max(min, Math.min(tickLower, base));
  tickUpper = Math.min(max, Math.max(tickUpper, base + tickSpacing));
  return { tickLower, tickUpper };
}

/* ------------------------------------------------------------------------ */
/* Distribution and depth (float, for charts)                                */
/* ------------------------------------------------------------------------ */

/**
 * Build the initialized ticks and the active liquidity from a list of
 * positions. Handy for tests, demos and for previewing how a new position
 * changes the curve.
 */
export function ticksFromPositions(
  positions: ReadonlyArray<{ tickLower: number; tickUpper: number; liquidity: bigint }>,
  currentTick: number,
) {
  const net = new Map<number, bigint>();
  let liquidity = 0n;
  for (const p of positions) {
    net.set(p.tickLower, (net.get(p.tickLower) ?? 0n) + p.liquidity);
    net.set(p.tickUpper, (net.get(p.tickUpper) ?? 0n) - p.liquidity);
    if (currentTick >= p.tickLower && currentTick < p.tickUpper) {
      liquidity += p.liquidity;
    }
  }
  const ticks: Array<TickData> = [...net]
    .flatMap(([tick, liquidityNet]) => (liquidityNet === 0n ? [] : [{ tick, liquidityNet }]))
    .sort((a, b) => a.tick - b.tick);
  return { ticks, liquidity };
}

/**
 * Slice the curve into bins around the current price, each `binSize` ticks
 * wide (defaults to the tick spacing), walking `bins` bins out on each side.
 * Liquidity is reconstructed from `liquidityNet` the way the pool does it
 * when the price crosses ticks, starting from the active liquidity.
 */
export function getLiquidityBins(
  pool: PoolState,
  ticks: ReadonlyArray<TickData>,
  { bins = 100, binSize = pool.tickSpacing }: { bins?: number; binSize?: number } = {},
): Array<LiquidityBin> {
  const { min, max } = usableTickBounds(pool.tickSpacing);
  const step = Math.max(
    pool.tickSpacing,
    Math.round(binSize / pool.tickSpacing) * pool.tickSpacing,
  );
  const net = new Map<number, bigint>();
  for (const t of ticks) {
    net.set(t.tick, (net.get(t.tick) ?? 0n) + t.liquidityNet);
  }
  const sortedNet = [...net].sort(([a], [b]) => a - b);

  const start = Math.floor(pool.tick / step) * step;
  const sqrtCurrent = Math.sqrt(Math.pow(1.0001, pool.tick));
  const scale0 = Math.pow(10, pool.decimals0);
  const scale1 = Math.pow(10, pool.decimals1);

  // Sum of liquidityNet for initialized ticks in (from, to].
  const netBetween = (from: number, to: number) => {
    let sum = 0n;
    for (const [tick, liquidityNet] of sortedNet) {
      if (tick > to) {
        break;
      }
      if (tick > from) {
        sum += liquidityNet;
      }
    }
    return sum;
  };

  const make = (lower: number, liquidity: bigint): LiquidityBin => {
    const upper = lower + step;
    const sqrtA = Math.sqrt(Math.pow(1.0001, lower));
    const sqrtB = Math.sqrt(Math.pow(1.0001, upper));
    const L = Number(liquidity < 0n ? 0n : liquidity);
    const isCurrent = pool.tick >= lower && pool.tick < upper;
    const lo0 = isCurrent ? sqrtCurrent : sqrtA;
    const hi1 = isCurrent ? sqrtCurrent : sqrtB;
    const amount0 = lower > pool.tick || isCurrent ? (L * (1 / lo0 - 1 / sqrtB)) / scale0 : 0;
    const amount1 = upper <= pool.tick || isCurrent ? (L * (hi1 - sqrtA)) / scale1 : 0;
    return {
      tickLower: lower,
      tickUpper: upper,
      priceLower: tickToPrice(lower, pool.decimals0, pool.decimals1),
      priceUpper: tickToPrice(upper, pool.decimals0, pool.decimals1),
      liquidity: liquidity < 0n ? 0n : liquidity,
      amount0,
      amount1,
      isCurrent,
    };
  };

  // Liquidity inside a bin wider than the spacing can change part-way; take
  // the value at its lower edge, so bins line up with initialized ticks.
  const atStart = pool.liquidity - netBetween(start, pool.tick);
  const result: Array<LiquidityBin> = [make(start, atStart)];

  let liquidity = atStart;
  for (let i = 1, lower = start + step; i <= bins && lower + step <= max; i++, lower += step) {
    liquidity += netBetween(lower - step, lower);
    result.push(make(lower, liquidity));
  }
  liquidity = atStart;
  for (let i = 1, lower = start - step; i <= bins && lower >= min; i++, lower -= step) {
    liquidity -= netBetween(lower, lower + step);
    result.unshift(make(lower, liquidity));
  }
  return result;
}

/** Cumulative depth on one side at one price. Amounts in human units. */
export type DepthPoint = {
  price: number;
  /** Signed price move from the current price, in percent. */
  percent: number;
  /** Token0 the pool sells before the price reaches `price` (ask side, above). */
  amount0: number;
  /** Token1 the pool sells before the price reaches `price` (bid side, below). */
  amount1: number;
  /** The side's depth valued in token1 at the current price. */
  value: number;
};

/**
 * Cumulative depth curve from the bins: walking outward from the current
 * price, how much of each token the pool holds up to every bin edge. Above
 * the price that is token0 (what buyers take), below it token1 (what
 * sellers take). Both sides are valued in token1 at the current price so
 * they share one axis.
 */
export function getDepthCurve(bins: ReadonlyArray<LiquidityBin>, currentPrice: number) {
  const asks: Array<DepthPoint> = [
    { price: currentPrice, percent: 0, amount0: 0, amount1: 0, value: 0 },
  ];
  const bids: Array<DepthPoint> = [
    { price: currentPrice, percent: 0, amount0: 0, amount1: 0, value: 0 },
  ];
  const pct = (price: number) => (price / currentPrice - 1) * 100;

  let amount0 = 0;
  for (const bin of bins) {
    if (bin.amount0 <= 0) {
      continue;
    }
    amount0 += bin.amount0;
    asks.push({
      price: bin.priceUpper,
      percent: pct(bin.priceUpper),
      amount0,
      amount1: 0,
      value: amount0 * currentPrice,
    });
  }
  let amount1 = 0;
  for (const bin of [...bins].reverse()) {
    if (bin.amount1 <= 0) {
      continue;
    }
    amount1 += bin.amount1;
    bids.push({
      price: bin.priceLower,
      percent: pct(bin.priceLower),
      amount0: 0,
      amount1,
      value: amount1,
    });
  }
  return { asks, bids };
}

/**
 * Depth at ±`percent`: how much token0 a buyer can take before the price
 * rises `percent`, and how much token1 a seller can take before it falls
 * `percent`. Interpolates inside the bin the cut falls in.
 */
export function getMarketDepth(
  bins: ReadonlyArray<LiquidityBin>,
  currentPrice: number,
  percent: number,
) {
  const upPrice = currentPrice * (1 + percent / 100);
  const downPrice = currentPrice * (1 - percent / 100);
  let amount0 = 0;
  let amount1 = 0;
  for (const bin of bins) {
    if (bin.amount0 > 0) {
      const lo = Math.max(bin.priceLower, currentPrice);
      if (lo < upPrice) {
        amount0 +=
          bin.amount0 * shareOfBin(lo, bin.priceUpper, Math.min(upPrice, bin.priceUpper), "0");
      }
    }
    if (bin.amount1 > 0) {
      const hi = Math.min(bin.priceUpper, currentPrice);
      if (hi > downPrice) {
        amount1 +=
          bin.amount1 * shareOfBin(bin.priceLower, hi, Math.max(downPrice, bin.priceLower), "1");
      }
    }
  }
  return {
    percent,
    /** Token0 to move the price up `percent`. */
    amount0,
    /** Token1 to move the price down `percent`. */
    amount1,
    /** `amount0` valued in token1 at the current price. */
    value0: amount0 * currentPrice,
    value1: amount1,
  };
}

// Share of a bin's token amount between its near edge and `cut`, using the
// constant-liquidity curve: token0 ∝ 1/√p, token1 ∝ √p.
function shareOfBin(lo: number, hi: number, cut: number, side: "0" | "1") {
  if (hi <= lo) {
    return 0;
  }
  if (side === "0") {
    const total = 1 / Math.sqrt(lo) - 1 / Math.sqrt(hi);
    return total > 0 ? (1 / Math.sqrt(lo) - 1 / Math.sqrt(cut)) / total : 0;
  }
  const total = Math.sqrt(hi) - Math.sqrt(lo);
  return total > 0 ? (Math.sqrt(hi) - Math.sqrt(cut)) / total : 0;
}

/* ------------------------------------------------------------------------ */
/* Ranges                                                                    */
/* ------------------------------------------------------------------------ */

/** A position's range in ticks. `tickLower` < `tickUpper`, both multiples of the spacing. */
export type TickRange = { tickLower: number; tickUpper: number };

/** Symbol is all the charts need; any `Token` fits. */
export type PairToken = { symbol: string };

/** "USDC per ETH", or the other way round when inverted. */
export function priceUnit(token0: { symbol: string }, token1: { symbol: string }, invert = false) {
  return invert ? `${token0.symbol} per ${token1.symbol}` : `${token1.symbol} per ${token0.symbol}`;
}

/** Price at a tick in the displayed direction. */
export function displayPrice(
  tick: number,
  pool: Pick<PoolState, "decimals0" | "decimals1">,
  invert = false,
) {
  const price = tickToPrice(tick, pool.decimals0, pool.decimals1);
  return invert ? 1 / price : price;
}

/**
 * Move one edge of a range to `tick`, snapped to the spacing and kept one
 * spacing away from the other edge and inside the usable ticks.
 */
export function moveRangeEdge(
  range: TickRange,
  edge: "tickLower" | "tickUpper",
  tick: number,
  tickSpacing: number,
): TickRange {
  const { min, max } = usableTickBounds(tickSpacing);
  const t = Math.max(min, Math.min(max, Math.round(tick / tickSpacing) * tickSpacing));
  return edge === "tickLower"
    ? { tickLower: Math.min(t, range.tickUpper - tickSpacing), tickUpper: range.tickUpper }
    : { tickLower: range.tickLower, tickUpper: Math.max(t, range.tickLower + tickSpacing) };
}

/** Slide a whole range by `shift` ticks (snapped), or undefined when it would leave the usable ticks. */
export function shiftRange(
  range: TickRange,
  shift: number,
  tickSpacing: number,
): TickRange | undefined {
  const { min, max } = usableTickBounds(tickSpacing);
  const s = Math.round(shift / tickSpacing) * tickSpacing;
  const next = { tickLower: range.tickLower + s, tickUpper: range.tickUpper + s };
  return next.tickLower >= min && next.tickUpper <= max ? next : undefined;
}

/* ------------------------------------------------------------------------ */
/* Positions                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * An LP position, as read from the position manager's `positions(tokenId)`.
 * `fees0` / `fees1` are uncollected fees: simulate `collect` with max
 * amounts to get them, since `tokensOwed` alone misses fees accrued since
 * the position was last touched.
 */
export type Position<T = { symbol: string; decimals: number }> = {
  tokenId: bigint;
  token0: T;
  token1: T;
  /** Fee tier in hundredths of a bip. */
  fee?: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  fees0?: bigint;
  fees1?: bigint;
};

/** Exact token amounts a position (or `share` of it) holds at the pool's price. */
export function getPositionAmounts(
  position: Pick<Position, "tickLower" | "tickUpper" | "liquidity">,
  pool: Pick<PoolState, "tick" | "sqrtPriceX96">,
  { liquidity = position.liquidity }: { liquidity?: bigint } = {},
) {
  return getAmountsForLiquidity(
    pool.sqrtPriceX96 ?? getSqrtRatioAtTick(pool.tick),
    getSqrtRatioAtTick(position.tickLower),
    getSqrtRatioAtTick(position.tickUpper),
    liquidity,
  );
}
