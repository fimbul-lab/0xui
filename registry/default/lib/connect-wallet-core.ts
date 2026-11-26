import { connect, getConnectors, watchConnectors } from "@wagmi/core";
import type { Config, Connector } from "@wagmi/core";
import { createStore } from "@/lib/0xui-store";
import { isUserRejection } from "@/lib/0xui-utils";

export type ConnectPhase = "idle" | "connecting" | "cancelled" | "error";

export type WalletOption = {
  connector: Connector;
  id: string;
  name: string;
  /** Icon URL from the wallet itself (EIP-6963), when it provides one. */
  icon?: string;
  /** Announced by an installed browser extension (EIP-6963). */
  installed: boolean;
  /** The wallet used for the last successful connection. */
  recent: boolean;
};

const rank = (o: WalletOption) => (o.recent ? 0 : o.installed ? 1 : 2);

/**
 * Connectors as an ordered wallet list: recent first, then installed, then
 * the rest. The generic "injected" connector is dropped when installed
 * wallets announce themselves (EIP-6963), since it would duplicate one of them.
 */
export function walletOptions(connectors: ReadonlyArray<Connector>, recentId?: string) {
  const announced = connectors.some((c) => c.rdns);
  return connectors
    .flatMap((connector): Array<WalletOption> =>
      announced && connector.id === "injected"
        ? []
        : [
            {
              connector,
              id: connector.id,
              name: connector.id === "injected" ? "Browser wallet" : connector.name,
              icon: connector.icon,
              installed: Boolean(connector.rdns),
              recent: connector.id === recentId,
            },
          ],
    )
    .map((o, index) => ({ o, index }))
    .sort((a, b) => rank(a.o) - rank(b.o) || a.index - b.index)
    .map(({ o }) => o);
}

export type ConnectWalletState = {
  wallets: Array<WalletOption>;
  phase: ConnectPhase;
  /** The wallet a connection is waiting on. */
  pendingId: string | undefined;
  /** Why the last connection failed or was cancelled. */
  error: Error | null;
};

export type ConnectWalletController = {
  get(): ConnectWalletState;
  subscribe(listener: () => void): () => void;
  /** Ask the wallet to connect. Resolves true once it has, false when it failed or was rejected. */
  connect(wallet: WalletOption): Promise<boolean>;
  /** Clear the last error or cancellation. */
  reset(): void;
};

/** The wallet list from a wagmi config, plus connect state. Framework-free. */
export function createConnectWallet(config: Config): ConnectWalletController {
  let recentId: string | undefined;
  const store = createStore<ConnectWalletState>(
    {
      wallets: walletOptions(getConnectors(config)),
      phase: "idle",
      pendingId: undefined,
      error: null,
    },
    (store) => {
      let active = true;
      const sync = () => store.set({ wallets: walletOptions(getConnectors(config), recentId) });
      void Promise.resolve(config.storage?.getItem("recentConnectorId")).then((id) => {
        recentId = id ?? undefined;
        if (active) {
          sync();
        }
      });
      const stop = watchConnectors(config, { onChange: sync });
      sync();
      return () => {
        active = false;
        stop();
      };
    },
  );

  return {
    get: store.get,
    subscribe: store.subscribe,
    async connect(wallet) {
      store.set({ phase: "connecting", pendingId: wallet.id, error: null });
      try {
        await connect(config, { connector: wallet.connector });
        store.set({ phase: "idle", pendingId: undefined });
        return true;
      } catch (error_) {
        const error = error_ instanceof Error ? error_ : new Error(String(error_));
        store.set({
          phase: isUserRejection(error) ? "cancelled" : "error",
          pendingId: undefined,
          error,
        });
        return false;
      }
    },
    reset() {
      store.set({ phase: "idle", pendingId: undefined, error: null });
    },
  };
}
