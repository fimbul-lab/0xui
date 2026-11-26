// Docs: https://0xui.io/components/shielded-sync-status.md
import { Progress, ProgressIndicator, ProgressTrack } from "@ui-sdk/react/progress";
import { CheckIcon, Loader2Icon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/primitives/button";
import { useShieldedEngine, useShieldedStore } from "@/components/shielded-provider";
import { SHIELDED_SYNC_STAGES, type ShieldedSyncStage } from "@/lib/shielded-engine";
import {
  advanceSync,
  createShieldedSync,
  serverSync,
  type ShieldedSyncPhase,
  type ShieldedSyncView,
} from "@/lib/shielded-sync";
import { cn } from "@/lib/utils";

export { advanceSync, type ShieldedSyncPhase, type ShieldedSyncView };

export type UseShieldedSyncParameters = {
  /**
   * Chain to follow. Required, and not taken from the connected wallet: the
   * private balance lives on one chain whatever network the wallet is on.
   */
  chainId: number;
};

/**
 * Follow the private balance scan on a chain: phase, stage, a progress value
 * that never moves backwards, and `sync` to retry or refresh. The logic lives
 * in `createShieldedSync` (framework-free).
 */
export function useShieldedSync({ chainId }: UseShieldedSyncParameters) {
  const engine = useShieldedEngine();
  const follower = useMemo(() => createShieldedSync(engine, chainId), [engine, chainId]);
  const server = useMemo(() => serverSync(chainId), [chainId]);
  const state = useShieldedStore(follower, server);
  return { ...state, sync: follower.sync };
}

/** Default label for each scan stage. */
export const shieldedSyncStageLabels: Record<ShieldedSyncStage, string> = {
  notes: "Finding your funds",
  transactions: "Checking transaction history",
};

export type ShieldedSyncBarProps = {
  /** 0 to 1. */
  progress: number;
  /** Accessible name. */
  label?: string;
  className?: string;
};

/** The progress bar on its own. */
export function ShieldedSyncBar({
  progress,
  label = "Private balance sync",
  className,
}: ShieldedSyncBarProps) {
  const percent = Math.round(Math.min(Math.max(progress, 0), 1) * 100);
  return (
    <Progress value={percent} aria-label={label} className="w-full">
      <ProgressTrack
        className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
      >
        <ProgressIndicator className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out motion-reduce:transition-none" />
      </ProgressTrack>
    </Progress>
  );
}

export type ShieldedSyncStatusProps = UseShieldedSyncParameters & {
  /** "bar" shows the stage and a progress bar. "inline" is one line of text for a header or footer. */
  variant?: "bar" | "inline";
  className?: string;
};

/**
 * Scan progress for the private balance: which pass is running, a bar that
 * never moves backwards, and a retry when the scan fails. Renders nothing
 * until a scan has started.
 */
export function ShieldedSyncStatus({
  chainId,
  variant = "bar",
  className,
}: ShieldedSyncStatusProps) {
  const { phase, stage, progress, error, isUpdate, sync } = useShieldedSync({ chainId });
  if (phase === "idle") return null;

  const percent = Math.round(progress * 100);
  const step = SHIELDED_SYNC_STAGES.indexOf(stage) + 1;
  const label =
    phase === "synced"
      ? "Private balance up to date"
      : phase === "error"
        ? isUpdate
          ? "Couldn't update private balance"
          : "Couldn't sync private balance"
        : isUpdate
          ? "Updating private balance"
          : shieldedSyncStageLabels[stage];

  const action =
    phase === "error" ? (
      <Button variant="outline" size="xs" onClick={sync}>
        Retry <span className="sr-only">sync</span>
      </Button>
    ) : phase === "synced" ? (
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Sync again"
        title="Sync again"
        onClick={sync}
        // Grow the hit area past the small visual size.
        className="relative text-muted-foreground after:absolute after:-inset-2"
      >
        <RefreshCwIcon />
      </Button>
    ) : null;

  const icon =
    phase === "synced" ? (
      <CheckIcon aria-hidden className="size-4 shrink-0 text-emerald-500" />
    ) : phase === "error" ? (
      <TriangleAlertIcon aria-hidden className="size-4 shrink-0 text-destructive" />
    ) : (
      <Loader2Icon
        aria-hidden
        className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
      />
    );

  if (variant === "inline") {
    return (
      <span
        data-slot="shielded-sync-status"
        data-phase={phase}
        data-stage={stage}
        className={cn("inline-flex items-center gap-1.5 text-sm text-muted-foreground", className)}
      >
        {icon}
        <span role="status" title={error}>
          {label}
          {phase === "syncing" && <span className="tabular-nums"> {percent}%</span>}
        </span>
        {action}
      </span>
    );
  }

  return (
    <div
      data-slot="shielded-sync-status"
      data-phase={phase}
      data-stage={stage}
      className={cn("flex w-full flex-col gap-2 text-sm", className)}
    >
      <div className="flex min-h-6 items-center gap-2">
        {icon}
        <span
          role="status"
          className={cn("min-w-0 flex-1", phase === "error" && "text-destructive")}
        >
          {label}
        </span>
        {phase === "syncing" && (
          <span className="text-muted-foreground tabular-nums">
            {!isUpdate && (
              <span>
                Step {step} of {SHIELDED_SYNC_STAGES.length} ·{" "}
              </span>
            )}
            {percent}%
          </span>
        )}
        {action}
      </div>
      {phase !== "synced" && <ShieldedSyncBar progress={progress} />}
      {phase === "error" && (
        <p role="alert" className="text-muted-foreground">
          {error ?? "The scan stopped before it finished."}
          {isUpdate && " The balance shown is from the last successful sync."}
        </p>
      )}
    </div>
  );
}
