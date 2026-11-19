import { parseUnits } from "viem";
import { TokenAmount } from "@/components/token-amount";

export default function TokenAmountDemo() {
  return (
    <div className="flex flex-col items-center gap-2">
      <TokenAmount value={parseUnits("1234.567891", 6)} decimals={6} symbol="USDC" />
      <TokenAmount value={parseUnits("2.5", 18)} decimals={18} symbol="ETH" price={3150.42} />
      <TokenAmount value={parseUnits("12500000", 18)} decimals={18} symbol="UNI" compact />
    </div>
  );
}
