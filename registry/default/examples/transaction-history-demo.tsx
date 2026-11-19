import { parseEther } from "viem";
import { useConnection } from "wagmi";
import { TransactionButton } from "@/components/transaction-button";
import { TransactionHistory, recordTransaction } from "@/components/transaction-history";

const vitalik = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

export default function TransactionHistoryDemo() {
  const { address } = useConnection();
  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <TransactionButton
        chainId={1}
        size="sm"
        transaction={{ to: vitalik, value: parseEther("0.01") }}
        onSubmitted={(hash) =>
          recordTransaction({ hash, chainId: 1, from: address, description: "Send 0.01 ETH" })
        }
        hideStatus
        resetAfter={1000}
      >
        Send 0.01 ETH
      </TransactionButton>
      <TransactionHistory />
    </div>
  );
}
