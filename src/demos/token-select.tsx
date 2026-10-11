import { useState } from "react";
import { TokenSelect, type Token } from "@/components/token-select";
import { demoPrices } from "./prices";
import { useDemoTokens } from "./tokens";
import { demo } from "./demo";

export const Default = demo(function TokenSelectDemo() {
  const { tokens, isLoading } = useDemoTokens();
  const [token, setToken] = useState<Token>();
  return (
    <TokenSelect
      tokens={tokens}
      isLoading={isLoading}
      value={token}
      onValueChange={setToken}
      chainId={1}
      popular={["ETH", "USDC", "USDT", "WBTC"]}
      prices={demoPrices}
    />
  );
});
