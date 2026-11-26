import { createStore } from "@/lib/0xui-store";
import {
  SHIELDED_SYNC_STAGES,
  type ShieldedEngine,
  type ShieldedSync,
  type ShieldedSyncStage,
} from "@/lib/shielded-engine";

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
export function advanceSync(
  previous: ShieldedSyncView | undefined,
  next: ShieldedSync,
): ShieldedSyncView {
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

export type ShieldedSyncState = ShieldedSyncView & {
  chainId: number;
  /** True when balances are already showing and this scan only refreshes them. */
  isUpdate: boolean;
};

export type ShieldedSyncFollower = {
  get(): ShieldedSyncState;
  subscribe(listener: () => void): () => void;
  /** Scan now: retry after an error, or refresh early. */
  sync(): Promise<void>;
};

/** The scan before the browser has read it, e.g. in server HTML. */
export const serverSync = (chainId: number): ShieldedSyncState => ({
  ...idleView,
  chainId,
  isUpdate: false,
});

/** Follow the private balance scan on a chain. Framework-free. */
export function createShieldedSync(engine: ShieldedEngine, chainId: number): ShieldedSyncFollower {
  // Balances exist once a scan has finished, so a scan after that is an update.
  const withUpdate = (view: ShieldedSyncView): ShieldedSyncState => ({
    ...view,
    // Always present: the store merges, so a missing key would keep the last error.
    error: view.error,
    chainId,
    isUpdate: engine.getBalances(chainId) !== undefined && view.phase !== "synced",
  });

  const store = createStore(
    withUpdate(advanceSync(undefined, engine.getSync(chainId))),
    (store) => {
      store.set(withUpdate(advanceSync(undefined, engine.getSync(chainId))));
      const stopSync = engine.subscribe("sync", () =>
        store.set((previous) => withUpdate(advanceSync(previous, engine.getSync(chainId)))),
      );
      const stopBalances = engine.subscribe("balances", () =>
        store.set((current) => withUpdate(current)),
      );
      return () => {
        stopSync();
        stopBalances();
      };
    },
  );

  return {
    get: store.get,
    subscribe: store.subscribe,
    sync: () => engine.sync(chainId),
  };
}
