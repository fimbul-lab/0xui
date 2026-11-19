import { useState } from "react";
import { TokenSelect, type Token } from "@/components/token-select";
import { useTokenList } from "@/hooks/use-token-list";
import { UNISWAP_DEFAULT_LIST } from "@/lib/token-list";

export default function TokenSelectDemo() {
  const { tokens, isLoading } = useTokenList(UNISWAP_DEFAULT_LIST, { chainId: 1 });
  const [token, setToken] = useState<Token>();
  return (
    <TokenSelect
      tokens={tokens}
      isLoading={isLoading}
      value={token}
      onValueChange={setToken}
      chainId={1}
      popular={["ETH", "USDC", "USDT", "WBTC"]}
    />
  );
}
