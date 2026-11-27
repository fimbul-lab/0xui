// Docs: https://0xui.io/components/add-token.md
import { CheckIcon, Loader2Icon, WalletIcon } from "lucide-react";
import { useMemo } from "react";
import type { ComponentProps, ReactNode } from "react";
import { useConfig } from "wagmi";
import { MorphText } from "@/components/morph-text";
import { Button } from "@/components/primitives/button";
import { useStore } from "@/hooks/use-store";
import { createTokenAdder } from "@/lib/add-token-core";
import type { AddTokenPhase, WatchedToken } from "@/lib/add-token-core";
import { errorCode, truncateAddress } from "@/lib/0xui-utils";
import { cn } from "@/lib/utils";

export type { AddTokenPhase };

/**
 * Adds `token` to the connected wallet (EIP-747), as React state. The logic
 * lives in `createTokenAdder` (framework-free); this only renders it.
 */
export function useAddToken(token: WatchedToken) {
  const config = useConfig();
  const adder = useMemo(() => createTokenAdder(config), [config]);
  const state = useStore(adder);
  return { ...state, add: () => adder.add(token) };
}

export type AddTokenProps = Omit<
  ComponentProps<typeof Button>,
  "onClick" | "children" | "className"
> & {
  /** ERC-20 to add. Wallets show `logoURI` as the token icon. */
  token: WatchedToken;
  children?: ReactNode;
  className?: string;
};

/**
 * "Add USDC to wallet" button (EIP-747). Renders nothing when no wallet is
 * connected. A declined prompt shows as cancelled.
 */
export function AddToken({
  token,
  children,
  variant = "outline",
  size = "sm",
  className,
  disabled,
  ...buttonProps
}: AddTokenProps) {
  const { phase, error, connected, add } = useAddToken(token);

  if (!connected) {
    return null;
  }

  return (
    <span
      data-slot="add-token"
      data-phase={phase}
      data-error={errorCode(phase, error)}
      className={cn("inline-flex flex-col gap-1", className)}
    >
      <Button
        variant={variant}
        size={size}
        disabled={disabled || phase === "added"}
        onClick={add}
        data-agent-confirm={`Asks your wallet to add ${token.symbol} (${truncateAddress(token.address)}) to its token list`}
        {...buttonProps}
      >
        {phase === "adding" ? (
          <Loader2Icon aria-hidden className="animate-spin" />
        ) : phase === "added" ? (
          <CheckIcon aria-hidden />
        ) : (
          <WalletIcon aria-hidden />
        )}
        <MorphText>
          {phase === "added"
            ? `${token.symbol} added`
            : (children ?? `Add ${token.symbol} to wallet`)}
        </MorphText>
      </Button>
      <span role="status" className="text-xs text-muted-foreground empty:hidden">
        {phase === "adding"
          ? "Confirm in your wallet."
          : phase === "cancelled"
            ? "Cancelled in wallet."
            : ""}
      </span>
      {phase === "error" && (
        <span role="alert" className="text-xs text-destructive">
          Your wallet couldn't add this token.
        </span>
      )}
    </span>
  );
}
