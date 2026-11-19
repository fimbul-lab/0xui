import { useState } from "react";
import { parseEther, type Hash } from "viem";
import { ShieldedTransactionStatus } from "@/components/shielded-transaction-status";
import { TransactionButton } from "@/components/transaction-button";
import { MOCK_SHIELD_CONTRACT } from "@/lib/mock-shielded-engine";
import { demoWeth, quickStart, shieldedDemo } from "./shielded-demo";

const amount = parseEther("0.5");
/** Shorter than the real 60 s, so the demo doesn't drag. */
const standby = 20;

export const Default = shieldedDemo(
  function FollowShield({ engine }) {
    const [hash, setHash] = useState<Hash>();
    return (
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        <TransactionButton
          chainId={1}
          transaction={{ to: MOCK_SHIELD_CONTRACT }}
          hideStatus
          onSubmitted={(sent) => {
            setHash(sent);
            // On a real chain the engine finds the shield by scanning. The mock is told.
            void engine.simulate.shield({ token: demoWeth.address, amount, hash: sent });
          }}
        >
          Shield 0.5 WETH
        </TransactionButton>
        {hash && (
          <ShieldedTransactionStatus
            key={hash}
            hash={hash}
            chainId={1}
            standby={standby}
            token={demoWeth}
            className="w-full"
          >
            Shield 0.5 WETH
          </ShieldedTransactionStatus>
        )}
      </div>
    );
  },
  { timings: { ...quickStart, standby: standby * 1_000 } }
);

/** A shield the engine already knows about. This hash is not on any chain. */
const restrictedHash = `0x${"5e".repeat(32)}` as const;

export const Restricted = shieldedDemo(
  () => (
    <ShieldedTransactionStatus
      hash={restrictedHash}
      chainId={1}
      token={demoWeth}
      className="max-w-sm"
    >
      Shield 2 WETH
    </ShieldedTransactionStatus>
  ),
  {
    funds: [
      {
        token: demoWeth.address,
        amount: parseEther("1.995"),
        state: "restricted",
        hash: restrictedHash,
      },
    ],
    timings: quickStart,
  }
);

/** A shield the engine has found and is holding for the standby period. Not on any chain. */
const pendingHash = `0x${"7a".repeat(32)}` as const;

export const Line = shieldedDemo(
  () => (
    <ShieldedTransactionStatus
      variant="line"
      hash={pendingHash}
      chainId={1}
      token={demoWeth}
      className="w-full max-w-sm"
    >
      Shield 0.5 WETH
    </ShieldedTransactionStatus>
  ),
  {
    funds: [
      {
        token: demoWeth.address,
        amount: parseEther("0.49875"),
        state: "pending",
        hash: pendingHash,
      },
    ],
    timings: quickStart,
  }
);
