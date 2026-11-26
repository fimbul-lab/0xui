import {
  getConnection,
  signMessage,
  signTypedData,
  verifyMessage,
  verifyTypedData,
  watchConnection,
  type Config,
} from "@wagmi/core";
import type { Address, Hex, SignableMessage, TypedDataDefinition } from "viem";
import { createStore } from "@/lib/0xui-store";
import { isUserRejection } from "@/lib/0xui-utils";

export type SignPhase =
  | "idle"
  | "signing"
  | "verifying"
  | "signed"
  | "invalid"
  | "cancelled"
  | "error";

export type SignRequest =
  | { message: SignableMessage; typedData?: never }
  | { typedData: TypedDataDefinition; message?: never };

export type MessageSignerState = {
  phase: SignPhase;
  /** The last signature, kept while it's verified. */
  signature: Hex | undefined;
  /** Why the last request failed. A rejection in the wallet shows as phase `cancelled`. */
  error: Error | undefined;
  /** The connected account, which signs. */
  address: Address | undefined;
};

export type SignOptions = {
  /** Check the signature against the connected address after signing. */
  verify?: boolean;
  /** Called with the signature, before it's verified. */
  onSigned?: (signature: Hex) => void;
};

export type MessageSigner = {
  get(): MessageSignerState;
  subscribe(listener: () => void): () => void;
  /**
   * Ask the wallet to sign. Verification goes through the RPC, so
   * smart-contract wallets (ERC-1271/6492) verify too. Resolves with the
   * signature, or undefined when nothing was signed.
   */
  sign(request: SignRequest, options?: SignOptions): Promise<Hex | undefined>;
  /** Back to idle, forgetting the last signature. */
  reset(): void;
};

/** Signs messages (EIP-191) and typed data (EIP-712) with the connected wallet. Framework-free. */
export function createMessageSigner(config: Config): MessageSigner {
  const store = createStore<MessageSignerState>(
    {
      phase: "idle",
      signature: undefined,
      error: undefined,
      address: getConnection(config).address,
    },
    (store) => {
      store.set({ address: getConnection(config).address });
      return watchConnection(config, {
        onChange: (connection) => store.set({ address: connection.address }),
      });
    },
  );

  return {
    get: store.get,
    subscribe: store.subscribe,
    async sign(request, { verify = false, onSigned } = {}) {
      const address = getConnection(config).address;
      if (!address) return undefined;
      store.set({ phase: "signing", signature: undefined, error: undefined });
      try {
        const signature = request.typedData
          ? await signTypedData(config, request.typedData)
          : await signMessage(config, { message: request.message });
        store.set({ signature });
        onSigned?.(signature);
        if (!verify) {
          store.set({ phase: "signed" });
          return signature;
        }
        store.set({ phase: "verifying" });
        const valid = request.typedData
          ? await verifyTypedData(config, { ...request.typedData, address, signature })
          : await verifyMessage(config, { address, signature, message: request.message });
        store.set({ phase: valid ? "signed" : "invalid" });
        return signature;
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        store.set({ error, phase: isUserRejection(error) ? "cancelled" : "error" });
        return undefined;
      }
    },
    reset() {
      store.set({ phase: "idle", signature: undefined, error: undefined });
    },
  };
}
