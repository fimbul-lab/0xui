import { getConnection, watchAsset, watchConnection } from "@wagmi/core";
import type { Config } from "@wagmi/core";
import type { Address } from "viem";
import { createStore } from "@/lib/0xui-store";
import { isUserRejection } from "@/lib/0xui-utils";

export type AddTokenPhase = "idle" | "adding" | "added" | "cancelled" | "error";

export type WatchedToken = { address: Address; symbol: string; decimals: number; logoURI?: string };

export type TokenAdderState = {
  phase: AddTokenPhase;
  /** Why the wallet couldn't add it. A declined prompt shows as phase `cancelled`. */
  error: Error | undefined;
  /** A wallet is connected, so there is one to add the token to. */
  connected: boolean;
};

export type TokenAdder = {
  get(): TokenAdderState;
  subscribe(listener: () => void): () => void;
  /** Ask the wallet to track the token (EIP-747). Resolves true once it has. */
  add(token: WatchedToken): Promise<boolean>;
};

/** Adds an ERC-20 to the connected wallet's token list. Framework-free. */
export function createTokenAdder(config: Config): TokenAdder {
  const connected = () => getConnection(config).status === "connected";
  const store = createStore<TokenAdderState>(
    { phase: "idle", error: undefined, connected: connected() },
    (store) => {
      store.set({ connected: connected() });
      return watchConnection(config, {
        onChange: (connection) => store.set({ connected: connection.status === "connected" }),
      });
    },
  );

  return {
    get: store.get,
    subscribe: store.subscribe,
    async add(token) {
      store.set({ phase: "adding", error: undefined });
      try {
        const added = await watchAsset(config, {
          type: "ERC20",
          options: {
            address: token.address,
            symbol: token.symbol,
            decimals: token.decimals,
            image: token.logoURI,
          },
        });
        store.set({ phase: added ? "added" : "cancelled" });
        return added;
      } catch (error_) {
        const error = error_ instanceof Error ? error_ : new Error(String(error_));
        store.set({ error, phase: isUserRejection(error) ? "cancelled" : "error" });
        return false;
      }
    },
  };
}
