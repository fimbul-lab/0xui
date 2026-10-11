import { useState } from "react";
import { parseEther, type Hash } from "viem";
import { TransactionButton } from "@/components/transaction-button";
import { TransactionStatus } from "@/components/transaction-status";
import { demoAccounts } from "./wagmi-config";
import { demo } from "./demo";

export const Default = demo(function SendWithStatus() {
  const [hash, setHash] = useState<Hash>();
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4">
      <TransactionButton
        chainId={1}
        transaction={{ to: demoAccounts[1], value: parseEther("0.01") }}
        onSubmitted={setHash}
        hideStatus
      >
        Send 0.01 ETH
      </TransactionButton>
      {hash && (
        <TransactionStatus hash={hash} chainId={1} className="w-full">
          Send 0.01 ETH to {demoAccounts[1].slice(0, 6)}…
        </TransactionStatus>
      )}
    </div>
  );
});
