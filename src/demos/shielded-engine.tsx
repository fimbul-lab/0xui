import { useState } from "react";
import { parseEther } from "viem";
import { PrivacyBadge } from "@/components/privacy-badge";
import { ShieldedAddress } from "@/components/shielded-address";
import { ShieldedBalance } from "@/components/shielded-balance";
import { useShieldedAccount } from "@/components/shielded-provider";
import { ShieldedSyncStatus } from "@/components/shielded-sync-status";
import { Button } from "@/components/primitives/button";
import { demoWeth, shieldedDemo, type ShieldedDemoProps } from "./shielded-demo";

const weth = demoWeth.address;

function Playground({ engine }: ShieldedDemoProps) {
  const { status, address } = useShieldedAccount();
  const [unlocking, setUnlocking] = useState(false);

  if (status !== "unlocked") {
    return (
      <Button
        size="sm"
        disabled={unlocking}
        onClick={() => {
          setUnlocking(true);
          void engine.account.unlock("password").finally(() => setUnlocking(false));
        }}
      >
        {unlocking ? "Unlocking…" : "Unlock the mock account"}
      </Button>
    );
  }

  const act = (label: string, run: () => unknown) => (
    <Button variant="outline" size="sm" onClick={() => void Promise.resolve(run()).catch(() => {})}>
      {label}
    </Button>
  );

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <PrivacyBadge privacy="private" iconOnly />
          {address && <ShieldedAddress address={address} />}
        </span>
        <Button variant="ghost" size="sm" onClick={() => engine.account.lock()}>
          Lock
        </Button>
      </div>
      <ShieldedBalance token={demoWeth} chainId={1} />
      <ShieldedSyncStatus chainId={1} />
      <div className="flex flex-wrap gap-2 border-t pt-4">
        {act("Shield 0.5", () => engine.simulate.shield({ token: weth, amount: parseEther("0.5") }))}
        {act("Shield, restricted", () =>
          engine.simulate.shield({ token: weth, amount: parseEther("0.5"), outcome: "restricted" })
        )}
        {act("Unshield 0.2", () =>
          engine.simulate.unshield({ token: weth, amount: parseEther("0.2") })
        )}
        {act("Unshield, change gets stuck", () =>
          engine.simulate.unshield({ token: weth, amount: parseEther("0.2"), change: "incomplete" })
        )}
        {act("Fail the next scan", () => {
          engine.simulate.failNextSync();
          return engine.sync(1);
        })}
      </div>
    </div>
  );
}

export const Default = shieldedDemo(Playground, {
  unlock: false,
  funds: [{ token: weth, amount: parseEther("1.25") }],
  // First scan in 8 s instead of 40, standby in 15 s instead of 60.
  timings: { firstScan: 8_000, standby: 15_000, settle: 8_000 },
});
