import { useEffect, useState } from "react";
import { parseEther, parseUnits } from "viem";
import { ShieldedBalance } from "@/components/shielded-balance";
import { ShieldedProvider } from "@/components/shielded-provider";
import { createMockShieldedEngine } from "@/lib/mock-shielded-engine";

const weth = {
  address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  symbol: "WETH",
  decimals: 18,
} as const;
const usdc = {
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  symbol: "USDC",
  decimals: 6,
} as const;

export default function ShieldedBalanceDemo() {
  const [engine] = useState(() =>
    createMockShieldedEngine({
      funds: [
        { token: weth.address, amount: parseEther("1.25") },
        { token: weth.address, amount: parseEther("0.4975"), state: "pending" },
        { token: usdc.address, amount: parseUnits("2400", 6) },
      ],
      timings: { firstScan: 3000 },
    }),
  );
  useEffect(() => {
    void engine.account.unlock("password");
    return () => engine.account.lock();
  }, [engine]);
  return (
    <ShieldedProvider engine={engine}>
      <div className="flex w-full max-w-sm flex-col gap-3">
        <ShieldedBalance token={weth} chainId={1} price={3150} />
        <p className="text-sm">
          Private USDC: <ShieldedBalance token={usdc} chainId={1} variant="inline" />
        </p>
      </div>
    </ShieldedProvider>
  );
}
