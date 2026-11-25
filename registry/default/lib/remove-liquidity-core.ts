import { getPositionAmounts, type PoolState, type Position } from "@/lib/concentrated-liquidity";
import { formatPair } from "@/lib/liquidity-utils";
import type { TokenInfo } from "@/lib/token-list";
import { withSlippage, type RemoveRequest } from "@/lib/v3-position-manager";

/** The quick picks under the slider, in percent. 100 reads "Max". */
export const removePresets = [25, 50, 75, 100] as const;

/**
 * What removing `percent` of a position returns: the share of liquidity,
 * the principal it holds at the current price, the slippage floor, and the
 * uncollected fees that come with it (all of them, at any percent).
 */
export function getRemoveAmounts(
  position: Position,
  pool: Pick<PoolState, "tick" | "sqrtPriceX96">,
  percent: number,
  slippageBps: number,
) {
  const liquidity = (position.liquidity * BigInt(Math.round(percent * 100))) / 10_000n;
  const principal = getPositionAmounts(position, pool, { liquidity });
  return {
    liquidity,
    amount0: principal.amount0,
    amount1: principal.amount1,
    amount0Min: withSlippage(principal.amount0, slippageBps),
    amount1Min: withSlippage(principal.amount1, slippageBps),
    fees0: position.fees0 ?? 0n,
    fees1: position.fees1 ?? 0n,
  };
}

export type RemoveAmounts = ReturnType<typeof getRemoveAmounts>;

/** Why nothing can be removed yet, as button text, or undefined. */
export function removeBlocker(position: Pick<Position, "liquidity">, percent: number) {
  if (position.liquidity === 0n) return "Position is closed";
  if (percent === 0) return "Select an amount";
  return undefined;
}

/** The request for `v3Remove` and other builders. `deadline` is unix seconds. */
export function removeRequest<T extends Pick<TokenInfo, "address" | "symbol">>({
  position,
  amounts,
  recipient,
  deadline,
}: {
  position: Position<T>;
  amounts: RemoveAmounts;
  recipient: RemoveRequest["recipient"];
  deadline: bigint;
}): RemoveRequest<T> {
  return {
    tokenId: position.tokenId,
    token0: position.token0,
    token1: position.token1,
    liquidity: amounts.liquidity,
    amount0Min: amounts.amount0Min,
    amount1Min: amounts.amount1Min,
    recipient,
    deadline,
  };
}

/**
 * What a person confirms before an agent's Remove goes to the wallet: the
 * share, the least it returns after slippage, and that the fees come too.
 * Set as the button's `data-agent-confirm`.
 */
export function removeConfirmText({
  tokenId,
  percent,
  amounts,
  token0,
  token1,
  chainName,
}: {
  tokenId: bigint;
  percent: number;
  amounts: RemoveAmounts;
  token0: Pick<TokenInfo, "symbol" | "decimals">;
  token1: Pick<TokenInfo, "symbol" | "decimals">;
  chainName?: string;
}) {
  const on = chainName ? ` on ${chainName}` : "";
  const least = formatPair(amounts.amount0Min, amounts.amount1Min, token0, token1);
  const fees = formatPair(amounts.fees0, amounts.fees1, token0, token1);
  return `Removes ${percent}% of position #${tokenId}${on}: at least ${least} back, plus ${fees} in fees, to your wallet`;
}
