import { CheckIcon, Loader2Icon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useShieldedEngine, useShieldedState } from "@/components/shielded-provider";
import { Button } from "@/components/ui/button";
import {
  SHIELDED_SYNC_STAGES,
  type ShieldedSync,
  type ShieldedSyncStage,
} from "@/lib/shielded-engine";
import { cn } from "@/lib/utils";

export type ShieldedSyncPhase = "idle" | "syncing" | "synced" | "error";

/** A scan as the UI shows it: one progress value for the whole scan that only moves forward. */
export type ShieldedSyncView = {
  phase: ShieldedSyncPhase;
  /** The pass that is running, or ran last. */
  stage: ShieldedSyncStage;
  /** 0 to 1 across every stage. Never lower than it was earlier in the same scan. */
  progress: number;
  /** Why the scan failed. */
  error?: string;
};

const idleView: ShieldedSyncView = { phase: "idle", stage: "notes", progress: 0 };

/**
 * Fold the engine's next scan state into what the UI shows.
 *
 * Engines report progress per stage and it can go backwards. This spreads
 * the stages evenly over one 0 to 1 range and keeps the highest value seen
 * since the scan started. A scan that starts after one finished or failed
 * begins again from 0.
 */
export function advanceSync(previous: ShieldedSyncView | undefined, next: ShieldedSync): ShieldedSyncView {
  if (next.status === "idle") return { ...idleView, stage: next.stage };
  if (next.status === "synced") return { phase: "synced", stage: next.stage, progress: 1 };

  if (next.status === "error") {
    // The bar stays where the scan stopped.
    const stoppedAt =
      previous?.phase === "syncing" || previous?.phase === "error" ? previous.progress : 0;
    return { phase: "error", stage: next.stage, progress: stoppedAt, error: next.error };
  }

  const running = previous?.phase === "syncing" ? previous.progress : 0;
  const stageProgress = Math.min(Math.max(next.progress, 0), 1);
  const overall =
    (SHIELDED_SYNC_STAGES.indexOf(next.stage) + stageProgress) / SHIELDED_SYNC_STAGES.length;
  return { phase: "syncing", stage: next.stage, progress: Math.max(running, overall) };
}

export type UseShieldedSyncParameters = {
  /**
   * Chain to follow. Required, and not taken from the connected wallet: the
   * private balance lives on one chain whatever network the wallet is on.
   */
  chainId: number;
};

/**
 * Follow the private balance scan on a chain: phase, stage, a progress value
 * that never moves backwards, and `sync` to retry or refresh.
 */
export function useShieldedSync({ chainId }: UseShieldedSyncParameters) {
  const engine = useShieldedEngine();

  const [view, setView] = useState(idleView);
  useEffect(() => {
    setView(advanceSync(undefined, engine.getSync(chainId)));
    return engine.subscribe("sync", () => {
      // Read now: by the time React runs the updater the engine may have moved on.
      const next = engine.getSync(chainId);
      setView((previous) => advanceSync(previous, next));
    });
  }, [engine, chainId]);

  // Balances exist once a scan has finished, so a scan after that is an update.
  const hasBalances = useShieldedState(
    "balances",
    (e) => e.getBalances(chainId) !== undefined,
    false
  );

  return {
    ...view,
    chainId,
    /** True when balances are already showing and this scan only refreshes them. */
    isUpdate: hasBalances && view.phase !== "synced",
    /** Scan now: retry after an error, or refresh early. */
    sync: () => engine.sync(chainId),
  };
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
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out motion-reduce:transition-none"
        style={{ width: `${percent}%` }}
      />
    </div>
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
        Retry
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
        <span role="status" className={cn("min-w-0 flex-1", phase === "error" && "text-destructive")}>
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
