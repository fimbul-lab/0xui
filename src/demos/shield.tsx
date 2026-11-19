import { ConnectWallet } from "@/components/connect-wallet";
import { Shield, type ShieldProps } from "@/components/shield";
import { ShieldedAccount } from "@/components/shielded-account";
import { ShieldedBalance } from "@/components/shielded-balance";
import type { Token } from "@/components/token-select";
import { demoPrices } from "./prices";
import { demoShieldedUsdc, demoWeth, quickStart, shieldedDemo } from "./shielded-demo";
import { demoUsdc } from "./tokens";

const weth: Token = { ...demoWeth, chainId: 1, name: "Wrapped Ether" };
const tokens = [weth, demoUsdc];

/** The shield block with the private balances under it, so the funds can be seen arriving. */
const shieldDemo = (variant: ShieldProps["variant"]) =>
  shieldedDemo(
    function ShieldDemo({ engine }) {
      return (
        <>
          <ShieldedAccount>
            <div className="flex w-full max-w-md flex-col gap-4">
              <Shield
                variant={variant}
                tokens={tokens}
                chainId={1}
                defaultToken={weth}
                popular={["WETH", "USDC"]}
                prices={demoPrices}
                // On a real chain the engine finds the shield by scanning. The mock is told.
                onSubmitted={(hash, draft) => void engine.simulate.shield({ ...draft, hash })}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <ShieldedBalance token={demoWeth} chainId={1} />
                <ShieldedBalance token={demoShieldedUsdc} chainId={1} />
              </div>
            </div>
          </ShieldedAccount>
          <ConnectWallet variant="link" size="sm">
            Connect the Demo Wallet to use it
          </ConnectWallet>
        </>
      );
    },
    // The standby period is 20 s here, not the real 60.
    { timings: { ...quickStart, standby: 20_000 } }
  );

export const Default = shieldDemo("in-place");

export const Collapse = shieldDemo("collapse");
