import { useState } from "react";
import { mainnet } from "wagmi/chains";
import { TokenInput } from "@/components/token-input";
import type { Token } from "@/components/token-select";
import { useTokenList } from "@/hooks/use-token-list";
import { UNISWAP_DEFAULT_LIST, nativeToken } from "@/lib/token-list";

// Fixed for the example. Fetch real prices in your app.
const prices = { ETH: 3150, USDC: 1, WBTC: 98000 };

export default function TokenInputDemo() {
  const { tokens } = useTokenList(UNISWAP_DEFAULT_LIST, { chainId: mainnet.id });
  const [value, setValue] = useState("");
  const [token, setToken] = useState<Token>(nativeToken(mainnet));
  return (
    <TokenInput
      label="You pay"
      value={value}
      onValueChange={setValue}
      token={token}
      onTokenChange={setToken}
      tokens={tokens}
      popular={["ETH", "USDC", "WBTC"]}
      prices={prices}
      className="w-full max-w-sm"
    />
  );
}
