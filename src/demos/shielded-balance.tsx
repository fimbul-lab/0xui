import { parseEther, parseUnits } from "viem";
import { ShieldedBalance } from "@/components/shielded-balance";
import { Button } from "@/components/ui/button";
import { demoShieldedUsdc, demoWeth, quickStart, shieldedDemo } from "./shielded-demo";

const weth = demoWeth.address;

export const Default = shieldedDemo(
  function ShieldAndSpend({ engine }) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-3">
        <ShieldedBalance token={demoWeth} chainId={1} price={3150.42} />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void engine.simulate.shield({ token: weth, amount: parseEther("0.5") })}
          >
            Shield 0.5 WETH
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              // Fails when less than 0.2 WETH is spendable. Nothing to show for that here.
              void engine.simulate
                .unshield({ token: weth, amount: parseEther("0.2") })
                .catch(() => {})
            }
          >
            Unshield 0.2 WETH
          </Button>
        </div>
      </div>
    );
  },
  {
    funds: [{ token: weth, amount: parseEther("1.25") }],
    // Shorter than the real 60 s standby, so the demo doesn't drag.
    timings: { ...quickStart, standby: 12_000, settle: 8_000 },
  }
);

export const States = shieldedDemo(
  () => <ShieldedBalance token={demoWeth} chainId={1} className="max-w-sm" />,
  {
    funds: [
      { token: weth, amount: parseEther("1.25") },
      { token: weth, amount: parseEther("0.4975"), state: "pending" },
      { token: weth, amount: parseEther("0.3"), state: "proving" },
      { token: weth, amount: parseEther("0.004975"), state: "incomplete" },
      { token: weth, amount: parseEther("2"), state: "restricted" },
    ],
    // Funds put straight into a state stay there until something moves them.
    timings: quickStart,
  }
);

export const StuckProofs = shieldedDemo(
  () => <ShieldedBalance token={demoWeth} chainId={1} className="max-w-sm" />,
  {
    funds: [
      { token: weth, amount: parseEther("0.005") },
      { token: weth, amount: parseEther("0.004975"), state: "incomplete" },
    ],
    timings: quickStart,
    setup: (engine) => engine.simulate.keepIncomplete(),
  }
);

export const Inline = shieldedDemo(
  () => (
    <dl className="grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Private WETH</dt>
      <dd>
        <ShieldedBalance token={demoWeth} chainId={1} variant="inline" />
      </dd>
      <dt className="text-muted-foreground">Private USDC</dt>
      <dd>
        <ShieldedBalance token={demoShieldedUsdc} chainId={1} variant="inline" />
      </dd>
    </dl>
  ),
  {
    funds: [
      { token: weth, amount: parseEther("1.25") },
      { token: demoShieldedUsdc.address, amount: parseUnits("2400", 6) },
      { token: demoShieldedUsdc.address, amount: parseUnits("100", 6), state: "pending" },
    ],
    timings: quickStart,
  }
);
