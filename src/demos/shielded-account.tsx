import { ShieldedAccount } from "@/components/shielded-account";
import { ShieldedBalance } from "@/components/shielded-balance";
import { Button } from "@/components/ui/button";
import { parseEther } from "viem";
import { demoWeth, quickStart, shieldedDemo } from "./shielded-demo";

/** A locked account. The password is "password". */
export const Default = shieldedDemo(() => <ShieldedAccount />, {
  unlock: false,
  timings: quickStart,
});

/** No account yet. Creation runs at its real speed: about six seconds. */
export const Create = shieldedDemo(
  function CreateAccount({ restart }) {
    return (
      <>
        <ShieldedAccount />
        <Button variant="link" size="sm" onClick={restart}>
          Start over
        </Button>
      </>
    );
  },
  { unlock: false, account: "none" }
);

export const Gate = shieldedDemo(
  function GatedBalance({ engine }) {
    return (
      <ShieldedAccount>
        <div className="flex w-full max-w-sm flex-col items-center gap-2">
          <ShieldedBalance token={demoWeth} chainId={1} />
          <Button variant="link" size="sm" onClick={() => engine.account.lock()}>
            Lock
          </Button>
        </div>
      </ShieldedAccount>
    );
  },
  {
    unlock: false,
    funds: [{ token: demoWeth.address, amount: parseEther("1.25") }],
    timings: quickStart,
  }
);
