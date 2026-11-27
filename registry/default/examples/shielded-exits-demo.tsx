import { useState } from "react";
import { parseEther } from "viem";
import { ShieldedAccount } from "@/components/shielded-account";
import { ShieldedBalance } from "@/components/shielded-balance";
import { ShieldedExits } from "@/components/shielded-exits";
import { ShieldedProvider } from "@/components/shielded-provider";
import { createMockShieldedEngine } from "@/lib/mock-shielded-engine";

const chainId = 11_155_111;
const weth = {
  address: "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9",
  symbol: "WETH",
  decimals: 18,
} as const;

export default function ShieldedExitDemo() {
  const [engine] = useState(() =>
    createMockShieldedEngine({
      chains: [chainId],
      timings: { firstScan: 3000 },
      funds: [
        { token: weth.address, amount: parseEther("1.5"), chainId },
        // No depositor given, so any connected wallet may send the exit.
        { token: weth.address, amount: parseEther("0.4"), state: "restricted", chainId },
      ],
    }),
  );
  return (
    <ShieldedProvider engine={engine}>
      {/* Unlock with the password "password". */}
      <ShieldedAccount>
        <div className="flex w-full max-w-md flex-col gap-4">
          <ShieldedBalance token={weth} chainId={chainId} />
          <ShieldedExits
            chainId={chainId}
            tokens={[weth]}
            // A real engine sees the exit by scanning. The mock is told.
            onSubmitted={(_hash, exit) => void engine.simulate.exit(exit.id, chainId)}
          />
        </div>
      </ShieldedAccount>
    </ShieldedProvider>
  );
}
