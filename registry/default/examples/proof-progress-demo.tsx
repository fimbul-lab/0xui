import { useEffect, useState } from "react";
import { parseEther } from "viem";
import { ProofProgress, useProof } from "@/components/proof-progress";
import { ShieldedProvider, useShieldedState } from "@/components/shielded-provider";
import { Button } from "@/components/primitives/button";
import { createMockShieldedEngine } from "@/lib/mock-shielded-engine";
import type { PrivateDraft } from "@/lib/shielded-engine";

const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const draft: PrivateDraft = {
  kind: "unshield",
  chainId: 1,
  token: weth,
  amount: parseEther("0.5"),
  recipient: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
};

function Unshield() {
  const proof = useProof();
  // Proofs spend private funds, which arrive with the first scan.
  const ready = useShieldedState(
    "balances",
    (engine) => engine.getBalances(1) !== undefined,
    false,
  );
  const start = () => void proof.prove(draft);
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4">
      <ProofProgress
        phase={proof.phase}
        stage={proof.stage}
        error={proof.error}
        onCancel={proof.cancel}
        onRetry={start}
      >
        Unshield 0.5 WETH
      </ProofProgress>
      <Button size="sm" onClick={start} disabled={!ready || proof.isProving}>
        {ready ? "Generate proof" : "Syncing…"}
      </Button>
    </div>
  );
}

export default function ProofProgressDemo() {
  const [engine] = useState(() =>
    createMockShieldedEngine({
      funds: [{ token: weth, amount: parseEther("1.25") }],
      timings: { firstScan: 3_000 },
    }),
  );
  useEffect(() => {
    void engine.account.unlock("password");
    return () => engine.account.lock();
  }, [engine]);
  return (
    <ShieldedProvider engine={engine}>
      <Unshield />
    </ShieldedProvider>
  );
}
