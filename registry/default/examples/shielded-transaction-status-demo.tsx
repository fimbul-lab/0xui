import { useEffect, useState } from "react";
import { parseEther } from "viem";
import { ShieldedProvider } from "@/components/shielded-provider";
import { ShieldedTransactionStatus } from "@/components/shielded-transaction-status";
import { createMockShieldedEngine } from "@/lib/mock-shielded-engine";

const weth = {
  address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  symbol: "WETH",
  decimals: 18,
} as const;
// A shield the mock engine already holds as pending. Use the hash your shield transaction returns.
const hash = `0x${"7a".repeat(32)}` as const;

export default function ShieldedTransactionStatusDemo() {
  const [engine] = useState(() =>
    createMockShieldedEngine({
      funds: [{ token: weth.address, amount: parseEther("0.49875"), state: "pending", hash }],
      timings: { firstScan: 3_000 },
    }),
  );
  useEffect(() => {
    void engine.account.unlock("password");
    return () => engine.account.lock();
  }, [engine]);
  return (
    <ShieldedProvider engine={engine}>
      <div className="flex w-full max-w-sm flex-col gap-4">
        <ShieldedTransactionStatus hash={hash} chainId={1} standby={60} token={weth}>
          Shield 0.5 WETH
        </ShieldedTransactionStatus>
        <ShieldedTransactionStatus variant="line" hash={hash} chainId={1} token={weth}>
          Shield 0.5 WETH
        </ShieldedTransactionStatus>
      </div>
    </ShieldedProvider>
  );
}
