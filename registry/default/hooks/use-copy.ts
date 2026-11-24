import { useMemo } from "react";
import { useStore } from "@/hooks/use-store";
import { createCopier } from "@/lib/copy";

/**
 * Copy text to the clipboard and expose a `copied` flag that resets after
 * `timeout` ms. `copy` resolves to `false` when the clipboard is unavailable
 * or permission is denied.
 */
export function useCopy({ timeout = 2000 }: { timeout?: number } = {}) {
  const copier = useMemo(() => createCopier({ timeout }), [timeout]);
  const { copied } = useStore(copier);
  return { copied, copy: copier.copy };
}
