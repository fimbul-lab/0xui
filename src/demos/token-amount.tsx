import { parseUnits } from "viem";
import { TokenAmount } from "@/components/token-amount";
import { demo } from "./demo";

export const Default = demo(() => (
  <TokenAmount value={parseUnits("1234.567891", 6)} decimals={6} symbol="USDC" />
));

export const WithFiat = demo(() => (
  <TokenAmount
    value={parseUnits("2.5", 18)}
    decimals={18}
    symbol="ETH"
    price={3150.42}
  />
));

export const Compact = demo(() => (
  <TokenAmount value={parseUnits("12500000", 18)} decimals={18} symbol="ARB" compact />
));

export const Dust = demo(() => <TokenAmount value={1n} decimals={18} symbol="ETH" />);
