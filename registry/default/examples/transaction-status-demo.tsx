import { useState } from "react";
import { parseEther, type Hash } from "viem";
import { TransactionButton } from "@/components/transaction-button";
import { TransactionStatus } from "@/components/transaction-status";

const vitalik = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

export default function TransactionStatusDemo() {
  const [hash, setHash] = useState<Hash>();
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4">
      <TransactionButton
        chainId={1}
        transaction={{ to: vitalik, value: parseEther("0.01") }}
        onSubmitted={setHash}
        hideStatus
      >
        Send 0.01 ETH
      </TransactionButton>
      {hash && (
        <TransactionStatus hash={hash} chainId={1} className="w-full">
          Send 0.01 ETH to vitalik.eth
        </TransactionStatus>
      )}
    </div>
  );
}
