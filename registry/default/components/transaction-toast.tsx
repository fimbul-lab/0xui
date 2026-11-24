// Docs: https://0xui.io/components/transaction-toast.md
import { useCallback, type ReactNode } from "react";
import type { Hash } from "viem";
import { useConfig } from "wagmi";
import {
  toastTransaction,
  type TransactionToastOptions as ToastOptionsOf,
} from "@/lib/transaction-toast-core";

export type TransactionToastOptions = ToastOptionsOf<ReactNode>;

/**
 * Returns a function that follows a transaction in a toast: "Transaction
 * pending" until it is mined, then "Transaction confirmed" or "Transaction
 * reverted", each with an explorer link. Needs `<Toaster />` from
 * `@/components/primitives/toast` mounted once in your app.
 *
 *   const toastTransaction = useTransactionToast();
 *   <TransactionButton onSubmitted={(hash) => toastTransaction(hash)} … />
 */
export function useTransactionToast() {
  const config = useConfig();
  return useCallback(
    (hash: Hash, options: TransactionToastOptions = {}) => toastTransaction(config, hash, options),
    [config],
  );
}
