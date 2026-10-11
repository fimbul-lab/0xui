import { useState } from "react";
import { TokenInput } from "@/components/token-input";
import type { Token } from "@/components/token-select";
import { demoPrices } from "./prices";
import { demoEth, useDemoTokens } from "./tokens";
import { demo } from "./demo";

export const Default = demo(function TokenInputDemo() {
  const { tokens } = useDemoTokens();
  const [value, setValue] = useState("");
  const [token, setToken] = useState<Token>(demoEth);
  return (
    <TokenInput
      label="You pay"
      value={value}
      onValueChange={setValue}
      token={token}
      onTokenChange={setToken}
      tokens={tokens}
      popular={["ETH", "USDC", "WBTC"]}
      prices={demoPrices}
      className="w-full max-w-sm"
    />
  );
});
