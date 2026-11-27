import { formatPair } from "@/lib/liquidity-utils";
import type { TokenInfo } from "@/lib/token-list";

/**
 * What a person confirms before an agent's Collect fees goes to the wallet:
 * the position, the exact fees and where they go. Set as the button's
 * `data-agent-confirm`.
 */
export function collectConfirmText({
  tokenId,
  fees0,
  fees1,
  token0,
  token1,
  chainName,
}: {
  tokenId: bigint;
  fees0: bigint;
  fees1: bigint;
  token0: Pick<TokenInfo, "symbol" | "decimals">;
  token1: Pick<TokenInfo, "symbol" | "decimals">;
  chainName?: string;
}) {
  const on = chainName ? ` on ${chainName}` : "";
  return `Collects the fees of position #${tokenId}${on}: ${formatPair(fees0, fees1, token0, token1)}, to your wallet`;
}
