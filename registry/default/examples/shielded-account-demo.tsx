import { useState } from "react";
import { parseEther } from "viem";
import { ShieldedAccount } from "@/components/shielded-account";
import { ShieldedBalance } from "@/components/shielded-balance";
import { ShieldedProvider } from "@/components/shielded-provider";
import { createMockShieldedEngine } from "@/lib/mock-shielded-engine";

const weth = {
  address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  symbol: "WETH",
  decimals: 18,
} as const;

export default function ShieldedAccountDemo() {
  // The mock account starts locked. Its password is "password".
  const [engine] = useState(() =>
    createMockShieldedEngine({
      funds: [{ token: weth.address, amount: parseEther("1.25") }],
      timings: { firstScan: 3000 },
    }),
  );
  return (
    <ShieldedProvider engine={engine}>
      <ShieldedAccount className="w-full max-w-sm">
        <ShieldedBalance token={weth} chainId={1} className="w-full max-w-sm" />
      </ShieldedAccount>
    </ShieldedProvider>
  );
}
