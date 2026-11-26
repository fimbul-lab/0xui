import { toast } from "@ui-sdk/core/toast";
import type { ToastAction, Toaster, ToastOptions } from "@ui-sdk/core/toast";
import { getPublicClient } from "@wagmi/core";
import type { Config } from "@wagmi/core";
import type { Hash, TransactionReceipt } from "viem";
import { getExplorerUrl } from "@/lib/0xui-utils";

export type TransactionToastOptions<Content = unknown> = {
  /** Chain the transaction was sent on. Defaults to the current chain. */
  chainId?: number;
  /** What the transaction does, e.g. "Swap 1 ETH for 3,150 USDC". Shown in every state. */
  description?: Content;
  /** Headings per state. */
  titles?: { pending?: string; success?: string; reverted?: string; error?: string };
  onConfirmed?: (receipt: TransactionReceipt) => void;
  /** Queue to show it in. Defaults to the shared `toast()` queue that `OverlayHost` renders. */
  toaster?: Toaster<any>;
};

/**
 * Follows a transaction in one toast: "Transaction pending" until it is
 * mined, then "Transaction confirmed" or "Transaction reverted", each with an
 * explorer link. Returns the toast's id. Framework-free.
 */
export function toastTransaction<Content>(
  config: Config,
  hash: Hash,
  options: TransactionToastOptions<Content> = {},
): string {
  const { chainId, description, titles = {}, onConfirmed } = options;
  const toaster: Toaster<any> = options.toaster ?? toast;
  const client = getPublicClient(config, { chainId });
  const url = getExplorerUrl(client?.chain, { tx: hash });
  // Stays open on press, so the toast keeps tracking while the explorer opens.
  const action: ToastAction<string> | undefined = url
    ? { label: "View", href: url, dismiss: false }
    : undefined;

  const id = toaster.loading(titles.pending ?? "Transaction pending", {
    description,
    action,
    duration: Number.POSITIVE_INFINITY,
  });

  // A toast closed while pending comes back for the outcome.
  const settle = (next: Omit<ToastOptions, "id">) => {
    const full = { description, action, ...next };
    if (!toaster.update(id, full)) toaster({ ...full, id });
  };

  if (!client) {
    settle({ type: "error", title: titles.error ?? "Couldn't track transaction", duration: 8000 });
    return id;
  }

  client
    .waitForTransactionReceipt({ hash })
    .then((receipt) => {
      if (receipt.status === "success") {
        settle({
          type: "success",
          title: titles.success ?? "Transaction confirmed",
          duration: 6000,
        });
        onConfirmed?.(receipt);
      } else {
        settle({
          type: "error",
          title: titles.reverted ?? "Transaction reverted",
          description: "Nothing changed except the gas fee.",
          duration: 10_000,
        });
      }
    })
    .catch(() => {
      settle({
        type: "error",
        title: titles.error ?? "Couldn't track transaction",
        description: "Check the explorer for its current state.",
        duration: 10_000,
      });
    });

  return id;
}
