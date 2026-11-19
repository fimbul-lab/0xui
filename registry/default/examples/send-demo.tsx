import { mainnet } from "wagmi/chains";
import { Send } from "@/components/send";
import { useTokenList } from "@/hooks/use-token-list";
import { UNISWAP_DEFAULT_LIST, nativeToken } from "@/lib/token-list";

const eth = nativeToken(mainnet);
// Fixed for the example. Fetch real prices in your app.
const prices = { ETH: 3150, USDC: 1, USDT: 1 };

export default function SendDemo() {
  const { tokens } = useTokenList(UNISWAP_DEFAULT_LIST, { chainId: mainnet.id });
  return (
    <Send
      tokens={tokens.length ? tokens : [eth]}
      defaultToken={eth}
      popular={["ETH", "USDC", "USDT"]}
      prices={prices}
    />
  );
}
