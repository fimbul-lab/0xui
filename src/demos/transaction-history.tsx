import { parseEther } from "viem";
import { useConnection } from "wagmi";
import { TransactionButton } from "@/components/transaction-button";
import { TransactionHistory, recordTransaction } from "@/components/transaction-history";
import { demoAccounts, demoRevertAddress } from "./wagmi-config";
import { demo } from "./demo";

export const Default = demo(function HistoryDemo() {
  const { address } = useConnection();
  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <TransactionButton
          chainId={1}
          size="sm"
          transaction={{ to: demoAccounts[1], value: parseEther("0.01") }}
          onSubmitted={(hash) =>
            recordTransaction({ hash, chainId: 1, from: address, description: "Send 0.01 ETH" })
          }
          hideStatus
          resetAfter={1000}
        >
          Send 0.01 ETH
        </TransactionButton>
        <TransactionButton
          chainId={1}
          size="sm"
          variant="outline"
          transaction={{ to: demoRevertAddress, value: parseEther("0.01") }}
          onSubmitted={(hash) =>
            recordTransaction({ hash, chainId: 1, from: address, description: "Send that reverts" })
          }
          hideStatus
        >
          Send (reverts)
        </TransactionButton>
      </div>
      <TransactionHistory />
    </div>
  );
});
