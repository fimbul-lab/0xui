import {
  getChainId,
  getConnection,
  switchChain,
  watchChainId,
  watchConnection,
  type Config,
} from "@wagmi/core";
import type { Chain } from "viem";
import { createStore } from "@/lib/0xui-store";
import { isUserRejection } from "@/lib/0xui-utils";

export type ChainSwitcherState = {
  /** Every chain in the wagmi config. */
  chains: ReadonlyArray<Chain>;
  /** The chain the app is on, or undefined while the wallet is on one it doesn't configure. */
  currentChain: Chain | undefined;
  /** The wallet is connected to a chain missing from the config. */
  unsupported: boolean;
  /** The chain a switch is waiting on, while the wallet asks. */
  pendingChainId: number | undefined;
  /** The last switch failed. A rejection in the wallet shows as `cancelled` instead. */
  error: Error | null;
  /** The last switch was rejected in the wallet. */
  cancelled: boolean;
};

export type ChainSwitcher = {
  get(): ChainSwitcherState;
  subscribe(listener: () => void): () => void;
  /** Ask the wallet to switch. Resolves true once it has, false when it failed or was rejected. */
  switchTo(chainId: number): Promise<boolean>;
  /** Clear the last error or cancellation. */
  reset(): void;
};

function readChain(config: Config) {
  const chains = config.chains;
  const connection = getConnection(config);
  // The wallet can be on a chain the app doesn't configure. getChainId still
  // reports the last configured chain, so check the connection directly.
  const unsupported =
    connection.status === "connected" &&
    connection.chainId !== undefined &&
    !chains.some((c) => c.id === connection.chainId);
  const chainId = getChainId(config);
  return {
    chains,
    unsupported,
    currentChain: unsupported ? undefined : chains.find((c) => c.id === chainId),
  };
}

/** Switches the wallet's chain and tracks the current one. Framework-free. */
export function createChainSwitcher(config: Config): ChainSwitcher {
  const store = createStore<ChainSwitcherState>(
    { ...readChain(config), pendingChainId: undefined, error: null, cancelled: false },
    (store) => {
      store.set(readChain(config));
      const sync = () => store.set(readChain(config));
      const stopChain = watchChainId(config, { onChange: sync });
      const stopConnection = watchConnection(config, { onChange: sync });
      return () => {
        stopChain();
        stopConnection();
      };
    },
  );

  return {
    get: store.get,
    subscribe: store.subscribe,
    async switchTo(chainId) {
      store.set({ pendingChainId: chainId, error: null, cancelled: false });
      try {
        await switchChain(config, { chainId });
        store.set({ pendingChainId: undefined, ...readChain(config) });
        return true;
      } catch (error) {
        const cancelled = isUserRejection(error);
        store.set({
          pendingChainId: undefined,
          cancelled,
          error: cancelled ? null : (error as Error),
        });
        return false;
      }
    },
    reset() {
      store.set({ error: null, cancelled: false });
    },
  };
}
