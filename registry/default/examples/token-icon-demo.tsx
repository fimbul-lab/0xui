import { TokenIcon } from "@/components/token-icon";

export default function TokenIconDemo() {
  return (
    <div className="flex items-center gap-3">
      <TokenIcon symbol="ETH" size={32} />
      <TokenIcon symbol="USDC" size={32} />
      <TokenIcon symbol="WBTC" size={32} />
      <TokenIcon symbol="USDC" chainId={1} size={40} />
    </div>
  );
}
