import { createStore } from "@/lib/0xui-store";

export type CopyState = {
  /** True for `timeout` ms after a successful copy. */
  copied: boolean;
};

export type Copier = {
  get(): CopyState;
  subscribe(listener: () => void): () => void;
  /** Write `text` to the clipboard. Resolves false when the clipboard is unavailable or permission is denied. */
  copy(text: string): Promise<boolean>;
  /** Clear `copied` now. */
  reset(): void;
};

/** Clipboard writes with a `copied` flag that resets after `timeout` ms. Framework-free. */
export function createCopier({ timeout = 2000 }: { timeout?: number } = {}): Copier {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const store = createStore<CopyState>({ copied: false }, () => () => {
    clearTimeout(timer);
    store.set({ copied: false });
  });

  return {
    get: store.get,
    subscribe: store.subscribe,
    async copy(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return false;
      }
      store.set({ copied: true });
      clearTimeout(timer);
      timer = setTimeout(() => store.set({ copied: false }), timeout);
      return true;
    },
    reset() {
      clearTimeout(timer);
      store.set({ copied: false });
    },
  };
}
