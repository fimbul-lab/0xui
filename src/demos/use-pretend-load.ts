import { useEffect, useState } from "react";

/** A pretend load for demos: false for `ms`, then true, so the skeleton shows before the data. */
export function usePretendLoad(ms = 1200) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return loaded;
}
