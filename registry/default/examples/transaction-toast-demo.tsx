import { parseEther } from "viem";
import { TransactionButton } from "@/components/transaction-button";
import { useTransactionToast } from "@/components/transaction-toast";
import { Toaster } from "@/components/ui/sonner";

const vitalik = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

export default function TransactionToastDemo() {
  const toastTransaction = useTransactionToast();
  return (
    <>
      <Toaster position="bottom-right" />
      <TransactionButton
        chainId={1}
        transaction={{ to: vitalik, value: parseEther("0.01") }}
        onSubmitted={(hash) => toastTransaction(hash, { chainId: 1, description: "Send 0.01 ETH" })}
        hideStatus
      >
        Send 0.01 ETH
      </TransactionButton>
    </>
  );
}
