import { useCallback, type ReactNode } from "react";
import { toast } from "sonner";
import type { Hash, TransactionReceipt } from "viem";
import { useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { getExplorerUrl } from "@/lib/0xui-utils";

export type TransactionToastOptions = {
  /** Chain the transaction was sent on. Defaults to the current chain. */
  chainId?: number;
  /** What the transaction does, e.g. "Swap 1 ETH for 3,150 USDC". Shown in every state. */
  description?: ReactNode;
  /** Headings per state. */
  titles?: { pending?: string; success?: string; reverted?: string; error?: string };
  onConfirmed?: (receipt: TransactionReceipt) => void;
};

/**
 * Returns a function that follows a transaction in a toast: "Transaction
 * pending" until it is mined, then "Transaction confirmed" or "Transaction
 * reverted", each with an explorer link. Needs a Sonner `<Toaster />`
 * mounted once in your app.
 *
 *   const toastTransaction = useTransactionToast();
 *   <TransactionButton onSubmitted={(hash) => toastTransaction(hash)} … />
 */
export function useTransactionToast() {
  const config = useConfig();

  return useCallback(
    (hash: Hash, options: TransactionToastOptions = {}) => {
      const { chainId, description, titles = {}, onConfirmed } = options;
      const client = getPublicClient(config, { chainId });
      const url = getExplorerUrl(client?.chain, { tx: hash });
      const action = url
        ? {
            label: "View",
            onClick: () => window.open(url, "_blank", "noopener,noreferrer"),
          }
        : undefined;

      const id = toast.loading(titles.pending ?? "Transaction pending", {
        description,
        action,
        // Stay up until the transaction settles.
        duration: Number.POSITIVE_INFINITY,
      });

      if (!client) {
        toast.error(titles.error ?? "Couldn't track transaction", {
          id,
          description,
          action,
          duration: 8_000,
        });
        return id;
      }

      client
        .waitForTransactionReceipt({ hash })
        .then((receipt) => {
          if (receipt.status === "success") {
            toast.success(titles.success ?? "Transaction confirmed", {
              id,
              description,
              action,
              duration: 6_000,
            });
            onConfirmed?.(receipt);
          } else {
            toast.error(titles.reverted ?? "Transaction reverted", {
              id,
              description: "Nothing changed except the gas fee.",
              action,
              duration: 10_000,
            });
          }
        })
        .catch(() => {
          toast.error(titles.error ?? "Couldn't track transaction", {
            id,
            description: "Check the explorer for its current state.",
            action,
            duration: 10_000,
          });
        });

      return id;
    },
    [config]
  );
}
