import { parseEther } from "viem";
import { ConnectWallet } from "@/components/connect-wallet";
import { ShieldedBalance } from "@/components/shielded-balance";
import { ShieldedExits } from "@/components/shielded-exits";
import { demoWeth, quickStart, shieldedDemo } from "./shielded-demo";
import { demoAccounts } from "./wagmi-config";

/** Restricted funds next to the balance they are part of, with their way out. */
export const Default = shieldedDemo(
  function ShieldedExitDemo({ engine }) {
    return (
      <>
        <div className="flex w-full max-w-md flex-col gap-4">
          <ShieldedBalance token={demoWeth} chainId={1} />
          <ShieldedExits
            chainId={1}
            tokens={[demoWeth]}
            // On a real chain the engine sees the exit by scanning. The mock is told.
            onConfirmed={() => {
              const [exit] = engine.getExits!(1) ?? [];
              if (exit) void engine.simulate.exit(exit.id);
            }}
          />
        </div>
        <ConnectWallet variant="link" size="sm">
          Connect the Demo Wallet to use it
        </ConnectWallet>
      </>
    );
  },
  {
    timings: quickStart,
    funds: [
      { token: demoWeth.address, amount: parseEther("1.5") },
      {
        token: demoWeth.address,
        amount: parseEther("0.4"),
        state: "restricted",
        depositor: demoAccounts[0],
      },
    ],
  }
);
