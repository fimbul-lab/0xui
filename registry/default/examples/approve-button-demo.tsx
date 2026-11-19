import { parseUnits } from "viem";
import { ApproveButton } from "@/components/approve-button";
import { TransactionButton } from "@/components/transaction-button";

const usdc = {
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  symbol: "USDC",
  decimals: 6,
} as const;
// Uniswap's universal router.
const router = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af";

export default function ApproveButtonDemo() {
  return (
    <ApproveButton token={usdc} spender={router} amount={parseUnits("100", 6)} chainId={1}>
      <TransactionButton chainId={1} transaction={{ to: router, data: "0x3593564c" }}>
        Swap 100 USDC
      </TransactionButton>
    </ApproveButton>
  );
}
