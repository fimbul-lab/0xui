import { parseEther } from "viem";
import { ProofProgress, useProof } from "@/components/proof-progress";
import { useShieldedState } from "@/components/shielded-provider";
import { Button } from "@/components/primitives/button";
import type { PrivateDraft } from "@/lib/shielded-engine";
import { demo } from "./demo";
import { demoAccounts } from "./wagmi-config";
import { demoWeth, quickStart, shieldedDemo } from "./shielded-demo";

const draft: PrivateDraft = {
  kind: "unshield",
  chainId: 1,
  token: demoWeth.address,
  amount: parseEther("0.5"),
  recipient: demoAccounts[0],
};

const options = {
  funds: [{ token: demoWeth.address, amount: parseEther("1.25") }],
  // The scan is shortened. The proof runs at its real speed: about 13 s the first time.
  timings: quickStart,
};

function Prover() {
  const proof = useProof();
  // A proof needs spendable funds, which arrive with the first scan.
  const ready = useShieldedState("balances", (engine) => engine.getBalances(1) !== undefined, false);
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
      {!proof.isProving && proof.phase !== "error" && proof.phase !== "cancelled" && (
        <Button size="sm" onClick={start} disabled={!ready}>
          {!ready ? "Syncing…" : proof.phase === "done" ? "Prove again" : "Generate proof"}
        </Button>
      )}
    </div>
  );
}

export const Default = shieldedDemo(Prover, options);

export const Failed = shieldedDemo(Prover, {
  ...options,
  circuitsCached: true,
  timings: { ...quickStart, prove: 3_000 },
  setup: (engine) => engine.simulate.failNextProof("The prover ran out of memory."),
});

export const Phases = demo(() => (
  <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-2">
    <ProofProgress phase="idle" />
    <ProofProgress phase="proving" />
    <ProofProgress phase="done" />
    <ProofProgress phase="cancelled" stage="proving" />
  </div>
));
