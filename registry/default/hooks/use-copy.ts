import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Copy text to the clipboard and expose a `copied` flag that resets after
 * `timeout` ms. `copy` resolves to `false` when the clipboard is unavailable
 * or permission is denied.
 */
export function useCopy({ timeout = 2000 }: { timeout?: number } = {}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return false;
      }
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), timeout);
      return true;
    },
    [timeout]
  );

  return { copied, copy };
}
