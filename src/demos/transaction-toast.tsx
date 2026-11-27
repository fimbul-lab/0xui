import { parseEther } from "viem";
import { Toaster } from "@/components/primitives/toast";
import { TransactionButton } from "@/components/transaction-button";
import { useTransactionToast } from "@/components/transaction-toast";
import { demoAccounts } from "./wagmi-config";
import { demo } from "./demo";

export const Default = demo(function ToastDemo() {
  const toastTransaction = useTransactionToast();
  return (
    <>
      <Toaster />
      <TransactionButton
        chainId={1}
        transaction={{ to: demoAccounts[1], value: parseEther("0.01") }}
        onSubmitted={(hash) => toastTransaction(hash, { chainId: 1, description: "Send 0.01 ETH" })}
        hideStatus
      >
        Send 0.01 ETH
      </TransactionButton>
    </>
  );
});
