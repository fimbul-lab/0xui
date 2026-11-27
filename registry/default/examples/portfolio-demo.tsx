import { Portfolio } from "@/components/portfolio";
import { useTokenList } from "@/hooks/use-token-list";
import { UNISWAP_DEFAULT_LIST } from "@/lib/token-list";

// Fixed for the example. Fetch real prices in your app.
const prices = { ETH: 3150, WETH: 3150, USDC: 1, USDT: 1, DAI: 1, WBTC: 98_000 };

export default function PortfolioDemo() {
  const { tokens, isLoading } = useTokenList(UNISWAP_DEFAULT_LIST, { chainId: 1 });
  return (
    <Portfolio
      tokens={tokens}
      isLoading={isLoading}
      prices={prices}
      address="0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
      chainId={1}
      title="vitalik.eth"
      className="w-full max-w-md"
    />
  );
}
