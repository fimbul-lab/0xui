// Docs: https://0xui.io/components/network-guard.md
import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { useConfig } from "wagmi";
import { Button } from "@/components/primitives/button";
import { useMounted } from "@/hooks/use-mounted";
import { useStore } from "@/hooks/use-store";
import { errorCode } from "@/lib/0xui-utils";
import { createNetworkGuard } from "@/lib/network-guard-core";
import type { NetworkGuardPhase } from "@/lib/network-guard-core";
import { cn } from "@/lib/utils";

export type { NetworkGuardPhase };

/**
 * Whether the connected wallet is on one of `chainIds`, and a way to switch
 * to the first. The logic lives in `createNetworkGuard` (framework-free).
 */
export function useNetworkGuard(chainIds: number | ReadonlyArray<number>) {
  const config = useConfig();
  const key = typeof chainIds === "number" ? String(chainIds) : chainIds.join(",");
  // Keyed by the ids rather than the array, which callers often pass inline.
  const guard = useMemo(() => createNetworkGuard(config, chainIds), [config, key]);
  const state = useStore(guard);
  const mounted = useMounted();
  const wrongNetwork = mounted && state.wrongNetwork;

  return {
    ...state,
    phase: wrongNetwork ? state.phase : ("ok" as NetworkGuardPhase),
    wrongNetwork,
    switchToTarget: guard.switchToTarget,
  };
}

export type NetworkGuardProps = {
  /** Chain or chains the content works on. The first one is offered as the switch target. */
  chainId: number | ReadonlyArray<number>;
  /**
   * "banner" shows a notice above the content. "replace" shows only the
   * notice until the wallet is on a supported chain.
   */
  mode?: "banner" | "replace";
  children: ReactNode;
  className?: string;
};

/**
 * Shows a "Switch to <chain>" notice when the connected wallet is on a
 * network the content doesn't support. Renders children as-is when the
 * network is right or no wallet is connected.
 */
export function NetworkGuard({ chainId, mode = "banner", children, className }: NetworkGuardProps) {
  const guard = useNetworkGuard(chainId);
  if (!guard.wrongNetwork) return <>{children}</>;

  const names = guard.allowedChains.map((c) => c.name);
  const supported =
    names.length <= 1
      ? (names[0] ?? "a different network")
      : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;

  const notice = (
    <div
      role="region"
      aria-label="Wrong network"
      data-slot="network-guard"
      data-phase={guard.phase}
      data-error={
        guard.cancelled
          ? "user-rejected"
          : guard.error
            ? errorCode("error", guard.error)
            : undefined
      }
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm",
        className,
      )}
    >
      <TriangleAlertIcon
        aria-hidden
        className="size-4 shrink-0 text-amber-600 dark:text-amber-400"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="font-medium">This works on {supported}.</p>
        <p className="text-muted-foreground" aria-live="polite">
          {guard.phase === "switching"
            ? "Approve the switch in your wallet."
            : guard.cancelled
              ? "Switch cancelled in wallet."
              : "Your wallet is on another network."}
        </p>
        {guard.error && (
          <p role="alert" className="text-destructive">
            {(guard.error as { shortMessage?: string }).shortMessage ?? guard.error.message}
          </p>
        )}
      </div>
      {guard.target && (
        <Button
          size="sm"
          onClick={guard.switchToTarget}
          data-agent-confirm={`Asks your wallet to switch to ${guard.target.name}`}
        >
          {guard.phase === "switching" && <Loader2Icon aria-hidden className="animate-spin" />}
          Switch to {guard.target.name}
        </Button>
      )}
    </div>
  );

  if (mode === "replace") return notice;
  return (
    <>
      {notice}
      {children}
    </>
  );
}
