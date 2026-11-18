import { ChevronDownIcon, LogOutIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  useConnection,
  useConnections,
  useDisconnect,
  useEnsName,
  useSwitchConnection,
  type Connector,
} from "wagmi";
import { mainnet } from "wagmi/chains";
import { AddressAvatar } from "@/components/address-avatar";
import { Balance } from "@/components/balance";
import { ChainBadge } from "@/components/chain-badge";
import { CopyButton } from "@/components/copy-button";
import { ExplorerLink } from "@/components/explorer-link";
import { MorphText } from "@/components/morph-text";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { truncateAddress } from "@/lib/0xui-utils";
import { cn } from "@/lib/utils";

/**
 * The connected account with its ENS name, plus disconnect. When more than
 * one wallet is connected, `otherAccounts` lists the rest and
 * `switchAccount` makes one of them the current account.
 */
export function useConnectedAccount() {
  const { address, connector, chain, chainId, status } = useConnection();
  const { data: ensName } = useEnsName({
    address,
    chainId: mainnet.id,
    query: { enabled: Boolean(address) },
  });
  const { mutate: disconnect, isPending: isDisconnecting } = useDisconnect();
  const connections = useConnections();
  const { mutate: switchConnection, isPending: isSwitching } = useSwitchConnection();
  const otherAccounts = connections.flatMap((connection) =>
    connection.connector.uid === connector?.uid || !connection.accounts[0]
      ? []
      : [{ address: connection.accounts[0], connector: connection.connector }]
  );

  return {
    address,
    ensName: ensName ?? undefined,
    displayName: ensName ?? (address ? truncateAddress(address) : undefined),
    connector,
    chain,
    chainId,
    status,
    disconnect: () => disconnect({ connector }),
    isDisconnecting,
    otherAccounts,
    switchAccount: (to: Connector) => switchConnection({ connector: to }),
    isSwitching,
  };
}

export type AccountProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Show the native balance in the trigger. */
  showBalance?: boolean;
  /** Called after the wallet disconnects. */
  onDisconnect?: () => void;
  /** Extra content at the bottom of the panel, e.g. links to your app's account pages. */
  children?: ReactNode;
  className?: string;
};

/**
 * Connected-account button: avatar and ENS name or address. Opens a panel
 * with balance, copy, explorer link, the other connected wallets to switch
 * to, and disconnect. Renders nothing when no
 * wallet is connected. For a single button that handles both states, use
 * WalletButton.
 */
export function Account({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  showBalance = false,
  onDisconnect,
  children,
  className,
}: AccountProps) {
  const account = useConnectedAccount();
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };

  if (!account.address) return null;
  const { address, displayName, ensName, connector, chainId } = account;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-full border bg-background py-1 pr-3 pl-1 text-sm font-medium outline-none",
          "hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
          className
        )}
      >
        <AddressAvatar address={address} size={30} />
        {showBalance && (
          <Balance className="text-muted-foreground" maxDecimals={3} />
        )}
        {/* Morphs from the address to the ENS name when it resolves. */}
        <span className={cn(!ensName && "font-mono")}>
          <MorphText>{displayName}</MorphText>
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-4 p-4">
        <div className="flex items-center gap-3">
          <AddressAvatar address={address} size={44} />
          <div className="flex min-w-0 flex-col">
            <span className={cn("truncate font-medium", !ensName && "font-mono")}>
              <MorphText>{displayName}</MorphText>
            </span>
            {ensName && (
              <span className="truncate font-mono text-xs text-muted-foreground">
                {truncateAddress(address)}
              </span>
            )}
          </div>
          <CopyButton
            value={address}
            label="Copy address"
            className="ml-auto"
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Balance</span>
          <Balance className="text-2xl font-semibold" />
        </div>

        <div className="flex items-center justify-between gap-2 text-sm">
          {chainId !== undefined && <ChainBadge chainId={chainId} />}
          <ExplorerLink address={address} className="text-muted-foreground" />
        </div>

        {account.otherAccounts.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Switch account</span>
            <ul className="-mx-2 flex flex-col">
              {account.otherAccounts.map((other) => (
                <li key={other.connector.uid}>
                  <button
                    type="button"
                    disabled={account.isSwitching}
                    onClick={() => account.switchAccount(other.connector)}
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                  >
                    <AddressAvatar address={other.address} size={24} />
                    <span className="font-mono">{truncateAddress(other.address)}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {other.connector.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {children}

        <div className="flex items-center justify-between gap-2 border-t pt-3">
          {connector && (
            <span className="text-xs text-muted-foreground">
              Connected with {connector.name}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={account.isDisconnecting}
            onClick={() => {
              account.disconnect();
              setOpen(false);
              onDisconnect?.();
            }}
          >
            <LogOutIcon aria-hidden />
            Disconnect
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
