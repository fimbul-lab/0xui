import { useState } from "react";
import { TokenSelect, type Token } from "@/components/token-select";
import { demoTokens } from "./tokens";
import { demo } from "./demo";

export const Default = demo(function TokenSelectDemo() {
  const [token, setToken] = useState<Token>();
  return (
    <TokenSelect
      tokens={demoTokens}
      value={token}
      onValueChange={setToken}
      chainId={1}
      popular={["ETH", "USDC", "USDT", "WBTC"]}
    />
  );
});
