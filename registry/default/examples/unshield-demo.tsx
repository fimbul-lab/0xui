import { useState } from "react";
import { parseEther, parseUnits } from "viem";
import { ShieldedAccount } from "@/components/shielded-account";
import { ShieldedBalance } from "@/components/shielded-balance";
import { ShieldedProvider } from "@/components/shielded-provider";
import { Unshield } from "@/components/unshield";
import { createMockShieldedEngine } from "@/lib/mock-shielded-engine";

const chainId = 11155111;
const weth = {
  chainId,
  address: "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9",
  name: "Wrapped Ether",
  symbol: "WETH",
  decimals: 18,
} as const;
const usdc = {
  chainId,
  address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  name: "USDC",
  symbol: "USDC",
  decimals: 6,
} as const;

export default function UnshieldDemo() {
  const [engine] = useState(() =>
    createMockShieldedEngine({
      chains: [chainId],
      timings: { firstScan: 3_000 },
      funds: [
        { token: weth.address, amount: parseEther("1.5"), chainId },
        { token: usdc.address, amount: parseUnits("2400", 6), chainId },
      ],
    }),
  );
  return (
    <ShieldedProvider engine={engine}>
      {/* Unlock with the password "password". */}
      <ShieldedAccount>
        <div className="flex w-full max-w-md flex-col gap-4">
          {/* The mock sends nothing, so the transaction it reports stays pending. A real engine's is mined. */}
          <Unshield
            tokens={[weth, usdc]}
            chainId={chainId}
            popular={["WETH", "USDC"]}
            prices={{ WETH: 3150, USDC: 1 }}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <ShieldedBalance token={weth} chainId={chainId} />
            <ShieldedBalance token={usdc} chainId={chainId} />
          </div>
        </div>
      </ShieldedAccount>
    </ShieldedProvider>
  );
}
