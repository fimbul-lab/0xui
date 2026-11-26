import {
  disconnect,
  getConnection,
  getConnections,
  switchConnection,
  watchConnection,
  watchConnections,
} from "@wagmi/core";
import type { Config, Connector, GetConnectionReturnType } from "@wagmi/core";
import type { Address, Chain } from "viem";
import { createStore } from "@/lib/0xui-store";
import { truncateAddress } from "@/lib/0xui-utils";

export type ConnectionStatus = GetConnectionReturnType["status"];

export type WalletButtonPhase = "restoring" | "disconnected" | "connected";

export type OtherAccount = { address: Address; connector: Connector };

export type ConnectedAccountState = {
  address: Address | undefined;
  connector: Connector | undefined;
  chain: Chain | undefined;
  chainId: number | undefined;
  status: ConnectionStatus;
  /** The other connected wallets, each with its first account. */
  otherAccounts: Array<OtherAccount>;
  isDisconnecting: boolean;
  isSwitching: boolean;
};

export type ConnectedAccount = {
  get(): ConnectedAccountState;
  subscribe(listener: () => void): () => void;
  /** Disconnect the current wallet. Resolves false when it failed. */
  disconnect(): Promise<boolean>;
  /** Make another connected wallet the current one. Resolves false when it failed. */
  switchAccount(connector: Connector): Promise<boolean>;
};

function readAccount(config: Config) {
  const { address, connector, chain, chainId, status } = getConnection(config);
  const otherAccounts = getConnections(config).flatMap((connection) =>
    connection.connector.uid === connector?.uid || !connection.accounts[0]
      ? []
      : [{ address: connection.accounts[0], connector: connection.connector }],
  );
  return { address, connector, chain, chainId, status, otherAccounts };
}

/** The connected account and the other connected wallets, with disconnect and switch. Framework-free. */
export function createConnectedAccount(config: Config): ConnectedAccount {
  const store = createStore<ConnectedAccountState>(
    { ...readAccount(config), isDisconnecting: false, isSwitching: false },
    (store) => {
      const sync = () => store.set(readAccount(config));
      sync();
      const stopConnection = watchConnection(config, { onChange: sync });
      const stopConnections = watchConnections(config, { onChange: sync });
      return () => {
        stopConnection();
        stopConnections();
      };
    },
  );

  return {
    get: store.get,
    subscribe: store.subscribe,
    async disconnect() {
      store.set({ isDisconnecting: true });
      try {
        await disconnect(config, { connector: store.get().connector });
        return true;
      } catch {
        return false;
      } finally {
        store.set({ isDisconnecting: false, ...readAccount(config) });
      }
    },
    async switchAccount(connector) {
      store.set({ isSwitching: true });
      try {
        await switchConnection(config, { connector });
        return true;
      } catch {
        return false;
      } finally {
        store.set({ isSwitching: false, ...readAccount(config) });
      }
    },
  };
}

/** The ENS name, or the truncated address when there is none. */
export function accountDisplayName(
  address: Address | undefined,
  ensName: string | null | undefined,
) {
  return ensName ?? (address ? truncateAddress(address) : undefined);
}

/** Which state a wallet button is in. "restoring" covers SSR and wagmi reconnecting on page load. */
export function walletButtonPhase(status: ConnectionStatus, mounted: boolean): WalletButtonPhase {
  if (!mounted || status === "reconnecting") return "restoring";
  return status === "connected" ? "connected" : "disconnected";
}
