import { encodeFunctionData, erc20Abi, parseUnits } from "viem";
import { BatchTransaction } from "@/components/batch-transaction";
import type { BatchCall } from "@/components/batch-transaction";

const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
// Uniswap's universal router.
const router = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af";

const calls: Array<BatchCall> = [
  {
    label: "Approve 100 USDC",
    to: usdc,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [router, parseUnits("100", 6)],
    }),
  },
  { label: "Swap 100 USDC for ETH", to: router, data: "0x3593564c" },
];

export default function BatchTransactionDemo() {
  return (
    <BatchTransaction calls={calls} chainId={1} className="w-full max-w-xs">
      Approve and swap
    </BatchTransaction>
  );
}
