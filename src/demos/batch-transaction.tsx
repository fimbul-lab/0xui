import { encodeFunctionData, erc20Abi, parseUnits } from "viem";
import { BatchTransaction, type BatchCall } from "@/components/batch-transaction";
import { demoUsdc } from "./tokens";
import { demo } from "./demo";

const router = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af";
const calls: Array<BatchCall> = [
  {
    label: "Approve 100 USDC",
    to: demoUsdc.address,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [router, parseUnits("100", 6)],
    }),
  },
  { label: "Swap 100 USDC for ETH", to: router, data: "0x3593564c" },
];

export const Atomic = demo(() => (
  <BatchTransaction calls={calls} chainId={1} className="w-full max-w-xs">
    Approve and swap
  </BatchTransaction>
));

export const Sequential = demo(() => (
  <BatchTransaction calls={calls} chainId={1} mode="sequential" className="w-full max-w-xs">
    Approve and swap
  </BatchTransaction>
));
