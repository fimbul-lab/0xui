import { useState } from "react";
import { TokenSelect, type Token } from "@/components/token-select";
import { demoPrices } from "./prices";
import { demoEth, useDemoTokens } from "./tokens";
import { useTokenList } from "@/hooks/use-token-list";
import { UNISWAP_DEFAULT_LIST } from "@/lib/token-list";
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

/** Only stablecoins (plus ETH, which filters never remove). */
export const Allowlisted = demo(function AllowlistDemo() {
  const { tokens, isLoading } = useTokenList(UNISWAP_DEFAULT_LIST, {
    chainId: 1,
    allowlist: [
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
      "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT
      "0x6B175474E89094C44Da98b954EedeAC495271d0F", // DAI
    ],
  });
  const [token, setToken] = useState<Token>();
  return (
    <TokenSelect tokens={tokens} isLoading={isLoading} value={token} onValueChange={setToken} chainId={1} />
  );
});

/** A list that never arrives, to show the loading state. */
export const Loading = demo(function LoadingDemo() {
  const [token, setToken] = useState<Token>();
  return <TokenSelect tokens={[demoEth]} isLoading value={token} onValueChange={setToken} chainId={1} />;
});
