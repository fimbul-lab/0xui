import { useSyncExternalStore } from "react";
import type { Store } from "@/lib/0xui-store";

/** The state of a 0xui store, re-rendering when it changes. */
export function useStore<S>(store: Pick<Store<S>, "get" | "subscribe">): S {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
