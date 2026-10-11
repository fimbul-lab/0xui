import { TokenIcon } from "@/components/token-icon";
import { demo } from "./demo";

export const Default = demo(() => (
  <div className="flex items-center gap-3">
    <TokenIcon symbol="ETH" size={32} />
    <TokenIcon symbol="USDC" size={32} />
    <TokenIcon symbol="WBTC" size={32} />
    <TokenIcon symbol="NOTATOKEN" size={32} />
  </div>
));

export const WithChain = demo(() => (
  <div className="flex items-center gap-3">
    <TokenIcon symbol="USDC" chainId={1} size={40} />
    <TokenIcon symbol="USDC" chainId={8453} size={40} />
  </div>
));
