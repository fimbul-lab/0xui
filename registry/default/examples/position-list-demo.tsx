import { PositionList } from "@/components/position-list";
import { useV3Positions } from "@/hooks/use-v3-positions";
import { nativeToken } from "@/lib/token-list";
import { uniswapV3Deployments, v3Collect } from "@/lib/v3-position-manager";
import { mainnet } from "wagmi/chains";

const { positionManager, weth } = uniswapV3Deployments[1];
const usdc = { chainId: 1, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", name: "USD Coin", symbol: "USDC", decimals: 6 } as const;

// The connected account's Uniswap v3 positions on Ethereum, read on-chain.
export default function PositionListDemo() {
  const { positions } = useV3Positions({ chainId: 1, tokens: [usdc], native: nativeToken(mainnet) });
  return (
    <div className="w-full max-w-md">
      <PositionList positions={positions} prices={{ USDC: 1, ETH: 3150 }} getCollectTransaction={v3Collect({ positionManager, weth })} />
    </div>
  );
}
