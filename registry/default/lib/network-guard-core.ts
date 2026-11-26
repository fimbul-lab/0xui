import { getConnection, switchChain, watchConnection, type Config } from "@wagmi/core";
import type { Chain } from "viem";
import { createStore } from "@/lib/0xui-store";
import { isUserRejection } from "@/lib/0xui-utils";

export type NetworkGuardPhase = "ok" | "wrong-network" | "switching";

export type NetworkGuardState = {
  phase: NetworkGuardPhase;
  /** A wallet is connected to a chain outside the allowed ones. */
  wrongNetwork: boolean;
  /** The allowed chains the config knows. */
  allowedChains: Array<Chain>;
  /** The chain the wallet is on. */
  currentChainId: number | undefined;
  /** The chain a switch goes to: the first allowed one. */
  target: Chain | undefined;
  /** The last switch was rejected in the wallet. */
  cancelled: boolean;
  /** The last switch failed. A rejection shows as `cancelled` instead. */
  error: Error | null;
};

export type NetworkGuard = {
  get(): NetworkGuardState;
  subscribe(listener: () => void): () => void;
  /** Ask the wallet to switch to `target`. Resolves true once it has. */
  switchToTarget(): Promise<boolean>;
};

/** Whether the connected wallet is on one of `chainIds`, and a way to switch to the first. Framework-free. */
export function createNetworkGuard(
  config: Config,
  chainIds: number | ReadonlyArray<number>,
): NetworkGuard {
  const allowed = typeof chainIds === "number" ? [chainIds] : chainIds;
  const allowedChains = config.chains.filter((c) => allowed.includes(c.id));
  const target = config.chains.find((c) => c.id === allowed[0]);
  let switching = false;

  const read = (): Pick<NetworkGuardState, "phase" | "wrongNetwork" | "currentChainId"> => {
    const connection = getConnection(config);
    const wrongNetwork =
      connection.status === "connected" &&
      connection.chainId !== undefined &&
      !allowed.includes(connection.chainId);
    return {
      wrongNetwork,
      currentChainId: connection.chainId,
      phase: !wrongNetwork ? "ok" : switching ? "switching" : "wrong-network",
    };
  };

  const store = createStore<NetworkGuardState>(
    { ...read(), allowedChains, target, cancelled: false, error: null },
    (store) => {
      store.set(read());
      return watchConnection(config, { onChange: () => store.set(read()) });
    },
  );

  return {
    get: store.get,
    subscribe: store.subscribe,
    async switchToTarget() {
      if (!target) return false;
      switching = true;
      store.set({ ...read(), cancelled: false, error: null });
      try {
        await switchChain(config, { chainId: target.id });
        return true;
      } catch (error) {
        const cancelled = isUserRejection(error);
        store.set({ cancelled, error: cancelled ? null : (error as Error) });
        return false;
      } finally {
        switching = false;
        store.set(read());
      }
    },
  };
}
