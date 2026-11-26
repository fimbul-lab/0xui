import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { ShieldedProvider } from "@/components/shielded-provider";
import type { ShieldedToken } from "@/components/shielded-balance";
import { createMockShieldedEngine } from "@/lib/mock-shielded-engine";
import type { MockShieldedEngine, MockShieldedEngineOptions } from "@/lib/mock-shielded-engine";
import { demo } from "./demo";

export const demoWeth: ShieldedToken = {
  address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  symbol: "WETH",
  decimals: 18,
};

export const demoShieldedUsdc: ShieldedToken = {
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  symbol: "USDC",
  decimals: 6,
};

/** Skip most of the 40 s first scan, for demos that are about something else. */
export const quickStart = { unlock: 300, firstScan: 3_000 };

export type ShieldedDemoProps = {
  /** This demo's own mock engine. */
  engine: MockShieldedEngine;
  /** Throw the engine away and start over with a fresh one. */
  restart: () => void;
};

/**
 * A demo with its own mock shielded engine, on top of `demo()`:
 *
 *   export const Default = shieldedDemo(({ engine }) => <ShieldedBalance … />, { funds });
 *
 * The engine is unlocked once the island has mounted, as if the user had
 * typed their password. `setup` runs just before that.
 */
export function shieldedDemo(
  Component: ComponentType<ShieldedDemoProps>,
  {
    unlock = true,
    setup,
    ...options
  }: MockShieldedEngineOptions & {
    unlock?: boolean;
    setup?: (engine: MockShieldedEngine) => void;
  } = {},
) {
  return demo(function ShieldedDemo() {
    const [run, setRun] = useState(0);
    // A new engine per run. Creating one starts no timers, so this is safe on the server.
    const engine = useMemo(() => createMockShieldedEngine(options), [run]);

    useEffect(() => {
      setup?.(engine);
      if (unlock) void engine.account.unlock("password");
      return () => engine.account.lock();
    }, [engine]);

    return (
      <ShieldedProvider engine={engine}>
        <Component engine={engine} restart={() => setRun((n) => n + 1)} />
      </ShieldedProvider>
    );
  });
}
