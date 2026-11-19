import { useEffect, useState } from "react";
import { parseEther } from "viem";
import { ShieldedBalance } from "@/components/shielded-balance";
import { ShieldedProvider } from "@/components/shielded-provider";
import { ShieldedSyncStatus } from "@/components/shielded-sync-status";
import { Button } from "@/components/ui/button";
import { createMockShieldedEngine } from "@/lib/mock-shielded-engine";

const weth = {
  address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  symbol: "WETH",
  decimals: 18,
} as const;

export default function MockShieldedEngineDemo() {
  const [engine] = useState(() =>
    createMockShieldedEngine({
      funds: [{ token: weth.address, amount: parseEther("1.25") }],
      timings: { firstScan: 8_000, standby: 15_000, settle: 8_000 },
    }),
  );
  useEffect(() => {
    // The mock account starts locked. Its password is "password".
    void engine.account.unlock("password");
    return () => engine.account.lock();
  }, [engine]);

  const run = (action: () => Promise<unknown>) => () => void action().catch(() => {});

  return (
    <ShieldedProvider engine={engine}>
      <div className="flex w-full max-w-sm flex-col gap-4">
        <ShieldedBalance token={weth} chainId={1} />
        <ShieldedSyncStatus chainId={1} />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={run(() =>
              engine.simulate.shield({ token: weth.address, amount: parseEther("0.5") }),
            )}
          >
            Shield 0.5
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={run(() =>
              engine.simulate.unshield({
                token: weth.address,
                amount: parseEther("0.2"),
                change: "incomplete",
              }),
            )}
          >
            Unshield 0.2, change gets stuck
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={run(() => {
              engine.simulate.failNextSync();
              return engine.sync(1);
            })}
          >
            Fail the next scan
          </Button>
        </div>
      </div>
    </ShieldedProvider>
  );
}
