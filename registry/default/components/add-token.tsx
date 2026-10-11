import { CheckIcon, Loader2Icon, WalletIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import type { Address } from "viem";
import { useConnection, useWatchAsset } from "wagmi";
import { Button } from "@/components/ui/button";
import { isUserRejection } from "@/lib/0xui-utils";
import { cn } from "@/lib/utils";

export type AddTokenPhase = "idle" | "adding" | "added" | "cancelled" | "error";

export type AddTokenProps = Omit<
  ComponentProps<typeof Button>,
  "onClick" | "children"
> & {
  /** ERC-20 to add. Wallets show `logoURI` as the token icon. */
  token: { address: Address; symbol: string; decimals: number; logoURI?: string };
  children?: ReactNode;
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
  const { status } = useConnection();
  const watch = useWatchAsset();

  if (status !== "connected") return null;

  const phase: AddTokenPhase = watch.isPending
    ? "adding"
    : watch.data === true
      ? "added"
      : watch.data === false || isUserRejection(watch.error)
        ? "cancelled"
        : watch.error
          ? "error"
          : "idle";

  return (
    <span
      data-slot="add-token"
      data-phase={phase}
      className={cn("inline-flex flex-col gap-1", className)}
    >
      <Button
        variant={variant}
        size={size}
        disabled={disabled || phase === "adding" || phase === "added"}
        aria-busy={phase === "adding" || undefined}
        onClick={() =>
          watch.mutate({
            type: "ERC20",
            options: {
              address: token.address,
              symbol: token.symbol,
              decimals: token.decimals,
              image: token.logoURI,
            },
          })
        }
        {...buttonProps}
      >
        {phase === "adding" ? (
          <Loader2Icon aria-hidden className="animate-spin" />
        ) : phase === "added" ? (
          <CheckIcon aria-hidden />
        ) : (
          <WalletIcon aria-hidden />
        )}
        {phase === "added"
          ? `${token.symbol} added`
          : (children ?? `Add ${token.symbol} to wallet`)}
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
