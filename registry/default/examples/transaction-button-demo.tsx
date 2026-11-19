import { erc20Abi, parseEther, parseUnits } from "viem";
import { TransactionButton } from "@/components/transaction-button";

const vitalik = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
// Uniswap's universal router.
const router = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af";

export default function TransactionButtonDemo() {
  return (
    <div className="flex flex-col items-center gap-2">
      <TransactionButton chainId={1} transaction={{ to: vitalik, value: parseEther("0.01") }}>
        Send 0.01 ETH
      </TransactionButton>
      <TransactionButton
        chainId={1}
        simulate
        contract={{
          address: usdc,
          abi: erc20Abi,
          functionName: "approve",
          args: [router, parseUnits("100", 6)],
        }}
      >
        Approve 100 USDC
      </TransactionButton>
      <TransactionButton chainId={1} disabledReason="Enter an amount" transaction={{ to: vitalik }}>
        Send
      </TransactionButton>
    </div>
  );
}
