import { parseUnits } from "viem";
import { mainnet } from "wagmi/chains";
import { Swap } from "@/components/swap";
import type { GetQuote } from "@/components/swap";
import { useTokenList } from "@/hooks/use-token-list";
import { UNISWAP_DEFAULT_LIST, isNativeToken, nativeToken } from "@/lib/token-list";

const eth = nativeToken(mainnet);
const usdc = {
  chainId: 1,
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  name: "USDCoin",
  symbol: "USDC",
  decimals: 6,
} as const;
// Uniswap's universal router.
const router = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af";
const prices: Record<string, number> = { ETH: 3150, USDC: 1, USDT: 1, DAI: 1, WBTC: 98000 };

// Quotes from fixed prices. Call your DEX or aggregator's API here instead.
const getQuote: GetQuote = async ({ sellToken, buyToken, sellAmount }) => {
  const sellPrice = prices[sellToken.symbol];
  const buyPrice = prices[buyToken.symbol];
  if (!sellPrice || !buyPrice) throw new Error("No route for this pair");
  const sellUnits = Number(sellAmount) / 10 ** sellToken.decimals;
  const buyUnits = ((sellUnits * sellPrice) / buyPrice) * 0.997;
  return {
    buyAmount: parseUnits(buyUnits.toFixed(buyToken.decimals), buyToken.decimals),
    transaction: {
      to: router,
      data: "0x3593564c",
      value: isNativeToken(sellToken) ? sellAmount : 0n,
    },
    spender: isNativeToken(sellToken) ? undefined : router,
  };
};

export default function SwapDemo() {
  const { tokens } = useTokenList(UNISWAP_DEFAULT_LIST, { chainId: mainnet.id });
  return (
    <Swap
      tokens={tokens}
      defaultSellToken={eth}
      defaultBuyToken={usdc}
      getQuote={getQuote}
      popular={["ETH", "USDC", "WBTC"]}
      prices={prices}
    />
  );
}
