// Docs: https://0xui.io/components/wallet-button.md
import { useMemo } from "react";
import { SkeletonBox } from "skullet/react";
import { useConfig } from "wagmi";
import { Account, type AccountProps } from "@/components/account";
import { ConnectWallet, type ConnectWalletProps } from "@/components/connect-wallet";
import { useMounted } from "@/hooks/use-mounted";
import { useStore } from "@/hooks/use-store";
import {
  createConnectedAccount,
  walletButtonPhase,
  type WalletButtonPhase,
} from "@/lib/account-core";
import { cn } from "@/lib/utils";

export type { WalletButtonPhase };

export type WalletButtonProps = {
  /** Props for the "Connect wallet" button and picker. */
  connect?: ConnectWalletProps;
  /** Props for the connected-account button and panel. */
  account?: AccountProps;
  className?: string;
};

/** Which state the wallet button is in. "restoring" covers SSR and wagmi reconnecting on page load. */
export function useWalletButtonPhase(): WalletButtonPhase {
  const config = useConfig();
  const account = useMemo(() => createConnectedAccount(config), [config]);
  const { status } = useStore(account);
  return walletButtonPhase(status, useMounted());
}

/**
 * The one wallet button most apps need: "Connect wallet" when disconnected,
 * the account button when connected, and a placeholder while a previous
 * connection is restored on page load, so it never flashes "Connect wallet"
 * at a returning user.
 */
export function WalletButton({ connect, account, className }: WalletButtonProps) {
  const phase = useWalletButtonPhase();

  if (phase === "restoring") {
    return (
      <span
        data-slot="wallet-button"
        data-phase={phase}
        // The size of the default "Connect wallet" button.
        className={cn("inline-flex h-10 w-[8.3rem]", className)}
      >
        <SkeletonBox width="100%" height="100%" radius="9999px" />
        <span className="sr-only">Restoring wallet connection</span>
      </span>
    );
  }

  if (phase === "connected") {
    return <Account {...account} className={cn(className, account?.className)} />;
  }

  return (
    <ConnectWallet
      {...connect}
      className={cn("h-10 rounded-full px-4", className, connect?.className)}
    />
  );
}
