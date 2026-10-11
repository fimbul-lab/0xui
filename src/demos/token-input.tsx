import { useState } from "react";
import { TokenInput } from "@/components/token-input";
import type { Token } from "@/components/token-select";
import { demoEth, demoTokens } from "./tokens";
import { demo } from "./demo";

export const Default = demo(function TokenInputDemo() {
  const [value, setValue] = useState("");
  const [token, setToken] = useState<Token>(demoEth);
  return (
    <TokenInput
      label="You pay"
      value={value}
      onValueChange={setValue}
      token={token}
      onTokenChange={setToken}
      tokens={demoTokens}
      popular={["ETH", "USDC", "WBTC"]}
      price={token.symbol === "ETH" ? 3150 : token.symbol.startsWith("USD") ? 1 : undefined}
      className="w-full max-w-sm"
    />
  );
});
