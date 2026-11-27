import { parseEther, parseUnits } from "viem";
import { ShieldedAccount } from "@/components/shielded-account";
import { ShieldedBalance } from "@/components/shielded-balance";
import type { Token } from "@/components/token-select";
import { Unshield } from "@/components/unshield";
import { demoPrices } from "./prices";
import { demoShieldedUsdc, demoWeth, quickStart, shieldedDemo } from "./shielded-demo";
import { demoUsdc } from "./tokens";
import { demoAccounts, sendDemoTransaction } from "./wagmi-config";

const weth: Token = { ...demoWeth, chainId: 1, name: "Wrapped Ether" };

/** The unshield block with the private balances under it, so the funds can be seen leaving. */
export const Default = shieldedDemo(
  function UnshieldDemo() {
    return (
      <ShieldedAccount>
        <div className="flex w-full max-w-md flex-col gap-4">
          <Unshield
            tokens={[weth, demoUsdc]}
            chainId={1}
            defaultToken={weth}
            popular={["WETH", "USDC"]}
            prices={demoPrices}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <ShieldedBalance token={demoWeth} chainId={1} />
            <ShieldedBalance token={demoShieldedUsdc} chainId={1} />
          </div>
        </div>
      </ShieldedAccount>
    );
  },
  {
    timings: quickStart,
    funds: [
      { token: demoWeth.address, amount: parseEther("1.5") },
      { token: demoShieldedUsdc.address, amount: parseUnits("2400", 6) },
    ],
    // A real relayer sends a real transaction. This one is made up, and the demo chain mines it.
    relay: ({ draft }) => sendDemoTransaction({ from: demoAccounts[1], to: draft.recipient }),
  },
);
