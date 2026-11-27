import { formatUnits } from "viem";
import type { Address, Hex } from "viem";
import { parseAmount } from "@/lib/0xui-utils";
import {
  displayPrice,
  formatPrice,
  getDependentAmount,
  getDepositMode,
  getSqrtRatioAtTick,
  isFullRange,
  priceUnit,
} from "@/lib/concentrated-liquidity";
import type { DepositMode, PoolState, TickRange } from "@/lib/concentrated-liquidity";
import { formatPair } from "@/lib/liquidity-utils";
import type { TokenInfo } from "@/lib/token-list";
import { withSlippage } from "@/lib/v3-position-manager";
import type { MintRequest } from "@/lib/v3-position-manager";

export type DepositSide = "token0" | "token1";

/** The amount the person typed, and on which side. The other side follows. */
export type TypedDeposit = { side: DepositSide; text: string };

export type MintTransaction = { to: Address; data?: Hex; value?: bigint };

/** Build the mint transaction. Sync or async, for a router API. */
export type GetMintTransaction<T extends Pick<TokenInfo, "address" | "symbol"> = TokenInfo> = (
  request: MintRequest<T>,
) => MintTransaction | Promise<MintTransaction>;

/** True when the range takes only the other token, so `side` is locked at 0. */
export function isSideLocked(mode: DepositMode, side: DepositSide) {
  return (mode === "token0" && side === "token1") || (mode === "token1" && side === "token0");
}

/**
 * Linked deposit amounts for a range: the typed side as entered, the other
 * at the ratio the range needs. A range outside the price takes one token;
 * a typed side it no longer takes counts as empty.
 */
export function getDepositAmounts({
  pool,
  range,
  token0,
  token1,
  typed,
}: {
  pool: Pick<PoolState, "tick" | "sqrtPriceX96">;
  range: TickRange;
  token0: Pick<TokenInfo, "decimals">;
  token1: Pick<TokenInfo, "decimals">;
  typed: TypedDeposit;
}) {
  const mode = getDepositMode(pool.tick, range.tickLower, range.tickUpper);
  const sqrtPriceX96 = pool.sqrtPriceX96 ?? getSqrtRatioAtTick(pool.tick);
  const tokens = { token0, token1 };
  const other: DepositSide = typed.side === "token0" ? "token1" : "token0";

  const typedText = isSideLocked(mode, typed.side) ? "" : typed.text;
  const typedAmount = typedText ? parseAmount(typedText, tokens[typed.side].decimals) : undefined;
  const dependent =
    typedAmount !== undefined && typedAmount > 0n
      ? getDependentAmount({ sqrtPriceX96, ...range, amount: typedAmount, token: typed.side })
      : undefined;

  const dependentText = dependent ? formatUnits(dependent, tokens[other].decimals) : "";
  const pair = <T>(typedValue: T, otherValue: T): Record<DepositSide, T> =>
    typed.side === "token0"
      ? { token0: typedValue, token1: otherValue }
      : { token0: otherValue, token1: typedValue };
  const amount = pair(typedAmount ?? 0n, dependent ?? 0n);
  return {
    mode,
    text: pair(typedText, dependentText),
    amount0: amount.token0,
    amount1: amount.token1,
  };
}

/** The first token the account can't cover, or undefined. Unknown balances pass. */
export function shortToken<T>(
  [token0, amount0, balance0]: [T, bigint, bigint | undefined],
  [token1, amount1, balance1]: [T, bigint, bigint | undefined],
) {
  if (balance0 !== undefined && amount0 > balance0) {
    return token0;
  }
  if (balance1 !== undefined && amount1 > balance1) {
    return token1;
  }
  return undefined;
}

/**
 * The mint request for a deposit, or undefined until there's an account and
 * an amount. `deadline` is 0 here: the transaction query fills it in when it
 * builds, so it isn't stale.
 */
export function mintRequest<T extends Pick<TokenInfo, "address" | "symbol">>({
  token0,
  token1,
  fee,
  range,
  amount0,
  amount1,
  slippageBps,
  recipient,
}: {
  token0: T;
  token1: T;
  fee?: number;
  range: TickRange;
  amount0: bigint;
  amount1: bigint;
  slippageBps: number;
  recipient: Address | undefined;
}): MintRequest<T> | undefined {
  if (!recipient || (amount0 === 0n && amount1 === 0n)) {
    return undefined;
  }
  return {
    token0,
    token1,
    fee,
    ...range,
    amount0Desired: amount0,
    amount1Desired: amount1,
    amount0Min: withSlippage(amount0, slippageBps),
    amount1Min: withSlippage(amount1, slippageBps),
    recipient,
    deadline: 0n,
  };
}

/**
 * TanStack query options that build the mint transaction with a fresh
 * deadline, and rebuild it every half deadline so it never goes stale.
 * Any TanStack adapter takes them.
 */
export function mintTransactionQueryOptions<
  T extends Pick<TokenInfo, "chainId" | "address" | "symbol">,
>({
  getTransaction,
  request,
  deadlineSeconds,
}: {
  getTransaction: GetMintTransaction<T>;
  request: MintRequest<T> | undefined;
  deadlineSeconds: number;
}) {
  const half = (deadlineSeconds * 1000) / 2;
  return {
    queryKey: [
      "0xui",
      "mint-transaction",
      request?.token0.chainId,
      request?.token0.address,
      request?.token1.address,
      request?.fee,
      request?.tickLower,
      request?.tickUpper,
      request?.amount0Desired.toString(),
      request?.amount1Desired.toString(),
      request?.amount0Min.toString(),
      request?.amount1Min.toString(),
      request?.recipient,
    ] as const,
    queryFn: () => {
      // `enabled` keeps the query from running without a request.
      if (!request) {
        throw new Error("No mint request to build a transaction for.");
      }
      return getTransaction({
        ...request,
        deadline: BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds),
      });
    },
    enabled: Boolean(request),
    staleTime: half,
    refetchInterval: half,
    retry: false,
  };
}

/**
 * Why the deposit can't be sent yet, as button text, or undefined when it's
 * ready. Undefined without an account too: the button opens the wallet
 * picker then.
 */
export function addLiquidityBlocker({
  connected,
  amount0,
  amount1,
  short,
  failed,
  ready,
}: {
  connected: boolean;
  amount0: bigint;
  amount1: bigint;
  short?: Pick<TokenInfo, "symbol">;
  failed: boolean;
  ready: boolean;
}) {
  if (!connected) {
    return undefined;
  }
  if (amount0 === 0n && amount1 === 0n) {
    return "Enter an amount";
  }
  if (short) {
    return `Insufficient ${short.symbol} balance`;
  }
  if (failed) {
    return "Can't build transaction";
  }
  if (!ready) {
    return "Preparing…";
  }
  return undefined;
}

/**
 * What a person confirms before an agent's Add liquidity goes to the
 * wallet: the exact deposit, the price range and the network. Set as the
 * button's `data-agent-confirm`.
 */
export function addLiquidityConfirmText({
  amount0,
  amount1,
  token0,
  token1,
  range,
  pool,
  invert = false,
  chainName,
  locale,
}: {
  amount0: bigint;
  amount1: bigint;
  token0: Pick<TokenInfo, "symbol" | "decimals">;
  token1: Pick<TokenInfo, "symbol" | "decimals">;
  range: TickRange;
  pool: Pick<PoolState, "tickSpacing" | "decimals0" | "decimals1">;
  invert?: boolean;
  chainName?: string;
  locale?: string;
}) {
  const on = chainName ? ` on ${chainName}` : "";
  const deposit = `Deposits ${formatPair(amount0, amount1, token0, token1)} from your wallet as liquidity`;
  if (isFullRange(range.tickLower, range.tickUpper, pool.tickSpacing)) {
    return `${deposit} over the full price range${on}`;
  }
  const edges = [
    displayPrice(range.tickLower, pool, invert),
    displayPrice(range.tickUpper, pool, invert),
  ];
  const [a, b] = [Math.min(...edges), Math.max(...edges)];
  const between = `${formatPrice(a, { locale })} and ${formatPrice(b, { locale })} ${priceUnit(token0, token1, invert)}`;
  return `${deposit} between ${between}${on}`;
}
