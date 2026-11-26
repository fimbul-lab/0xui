// Docs: https://0xui.io/components/connect-wallet.md
import { WalletIcon } from "@web3icons/react/dynamic";
import { ChevronRightIcon, Loader2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { useConfig } from "wagmi";
import type { Connector } from "wagmi";
import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import { Avatar, AvatarFallback } from "@/components/primitives/avatar";
import { Button } from "@/components/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/primitives/dialog";
import { useStore } from "@/hooks/use-store";
import { errorCode } from "@/lib/0xui-utils";
import { createConnectWallet } from "@/lib/connect-wallet-core";
import type { ConnectPhase, WalletOption } from "@/lib/connect-wallet-core";
import { cn } from "@/lib/utils";

export type { ConnectPhase, WalletOption };

function useConnectWalletController() {
  const config = useConfig();
  const controller = useMemo(() => createConnectWallet(config), [config]);
  return { controller, state: useStore(controller) };
}

/**
 * The connectors from your wagmi config as an ordered wallet list: recent
 * first, then installed, then the rest. The generic "injected" connector is
 * dropped when installed wallets announce themselves (EIP-6963), since it
 * would duplicate one of them.
 */
export function useWalletOptions() {
  return useConnectWalletController().state.wallets;
}

/**
 * Wallet list plus connect state. Build your own connect UI on this. The
 * logic lives in `createConnectWallet` (framework-free).
 */
export function useConnectWallet({
  onConnect,
}: { onConnect?: (connector: Connector) => void } = {}) {
  const { controller, state } = useConnectWalletController();

  const connect = async (wallet: WalletOption) => {
    const connected = await controller.connect(wallet);
    if (connected) {
      onConnect?.(wallet.connector);
    }
    return connected;
  };

  return { ...state, connect, reset: controller.reset };
}

export type ConnectWalletDialogProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Called after a wallet connects. The dialog closes itself. */
  onConnect?: (connector: Connector) => void;
  /** Dialog title. */
  title?: ReactNode;
  /** Wallets shown before "Other wallets". */
  maxVisible?: number;
  /** Small print under the list. Pass null to hide. */
  footer?: ReactNode;
  /** `auto` is a bottom sheet on small touch screens and a dialog otherwise. `dialog` and `drawer` force one. */
  mode?: "auto" | "dialog" | "drawer";
};

const presentations = { auto: "auto", dialog: "dialog", drawer: "sheet" } as const;

const defaultFooter =
  "Connecting shares your public address with this app. It can't move funds without your approval.";

/** The wallet picker on its own. Use it to open the picker from your own trigger. */
export function ConnectWalletDialog({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  onConnect,
  title = "Connect a wallet",
  maxVisible = 4,
  footer = defaultFooter,
  mode = "auto",
}: ConnectWalletDialogProps) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const [showAll, setShowAll] = useState(false);

  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };

  const { wallets, connect, phase, pendingId, error, reset } = useConnectWallet({
    onConnect: (connector) => {
      setOpen(false);
      onConnect?.(connector);
    },
  });

  // Fresh state every time the dialog opens.
  useEffect(() => {
    if (open) {
      reset();
      setShowAll(false);
    }
  }, [open, reset]);

  const visible = showAll ? wallets : wallets.slice(0, maxVisible);
  const hiddenCount = wallets.length - visible.length;
  const pendingName = wallets.find((w) => w.id === pendingId)?.name;

  return (
    <Dialog open={open} onOpenChange={setOpen} presentation={presentations[mode]}>
      <DialogContent
        data-phase={phase}
        data-error={errorCode(phase, error)}
        closeLabel="Close wallet picker"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Choose a wallet to connect to this app.
          </DialogDescription>
        </DialogHeader>
        {wallets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No wallets found. Install a browser wallet such as MetaMask or Rabby, then reload the
            page.
          </p>
        ) : (
          <ul className="-mx-2 flex flex-col gap-1">
            {visible.map((wallet) => (
              <li key={wallet.id}>
                <WalletRow
                  wallet={wallet}
                  pending={wallet.id === pendingId}
                  disabled={phase === "connecting"}
                  onSelect={() => connect(wallet)}
                />
              </li>
            ))}
          </ul>
        )}

        {hiddenCount > 0 && (
          <Button variant="ghost" className="-mt-2 self-start" onClick={() => setShowAll(true)}>
            Other wallets ({hiddenCount})
          </Button>
        )}

        <div aria-live="polite" className="text-sm empty:hidden">
          {phase === "connecting" && pendingName && (
            <p className="text-muted-foreground">Confirm the connection in {pendingName}.</p>
          )}
          {phase === "cancelled" && (
            <p className="text-muted-foreground">
              Request cancelled. Try again or pick another wallet.
            </p>
          )}
        </div>
        {phase === "error" && error && (
          <p role="alert" className="text-sm text-destructive">
            {(error as { shortMessage?: string }).shortMessage ?? error.message}
          </p>
        )}

        {footer && <p className="text-xs text-muted-foreground">{footer}</p>}
      </DialogContent>
    </Dialog>
  );
}

function WalletRow({
  wallet,
  pending,
  disabled,
  onSelect,
}: {
  wallet: WalletOption;
  pending: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <ButtonPrimitive
      onClick={onSelect}
      disabled={disabled}
      aria-busy={pending || undefined}
      data-agent-confirm={`Connects ${wallet.name} and shares your address with this site`}
      className={cn(
        "flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm font-medium outline-none",
        "hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
        pending && "bg-muted disabled:opacity-100",
      )}
    >
      <WalletOptionIcon wallet={wallet} />
      <span className="flex-1 truncate">{wallet.name}</span>{" "}
      {wallet.recent ? (
        <WalletBadge>Recent</WalletBadge>
      ) : wallet.installed ? (
        <WalletBadge>Installed</WalletBadge>
      ) : null}
      {pending ? (
        <Loader2Icon aria-hidden className="size-4 shrink-0 animate-spin" />
      ) : (
        <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      )}
    </ButtonPrimitive>
  );
}

function WalletBadge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
      {children}
    </span>
  );
}

/** Wallet logo: the wallet's own icon, then web3icons by name, then initials. */
export function WalletOptionIcon({
  wallet,
  className,
}: {
  wallet: Pick<WalletOption, "name" | "icon">;
  className?: string;
}) {
  // Decorative: the wallet name is always next to it.
  const fallback = (
    <Avatar aria-hidden className={cn("size-8 rounded-lg", className)}>
      <AvatarFallback className="rounded-lg text-xs">{initials(wallet.name)}</AvatarFallback>
    </Avatar>
  );

  if (wallet.icon) {
    return <img src={wallet.icon} alt="" className={cn("size-8 shrink-0 rounded-lg", className)} />;
  }
  return (
    <WalletIcon
      aria-hidden
      name={wallet.name}
      variant="background"
      className={cn("size-8 shrink-0 rounded-lg", className)}
      fallback={fallback}
    />
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export type ConnectWalletProps = Omit<ComponentProps<typeof Button>, "onClick"> &
  Pick<
    ConnectWalletDialogProps,
    | "open"
    | "defaultOpen"
    | "onOpenChange"
    | "onConnect"
    | "title"
    | "maxVisible"
    | "footer"
    | "mode"
  >;

/** "Connect wallet" button that opens the wallet picker. */
export function ConnectWallet({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  onConnect,
  title,
  maxVisible,
  footer,
  mode,
  children = "Connect wallet",
  ...buttonProps
}: ConnectWalletProps) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };

  return (
    <>
      <Button aria-haspopup="dialog" {...buttonProps} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <ConnectWalletDialog
        open={open}
        onOpenChange={setOpen}
        onConnect={onConnect}
        title={title}
        maxVisible={maxVisible}
        footer={footer}
        mode={mode}
      />
    </>
  );
}
