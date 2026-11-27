import { useState } from "react";
import { MixerWithdrawForm } from "@/components/mixer";
import { Button } from "@/components/primitives/button";
import { createMockMixerEngine } from "@/lib/mock-mixer-engine";

/** The withdraw form with a note already deposited, and the mock's controls next to it. */
export default function MockMixerEngineDemo() {
  const [engine] = useState(() => createMockMixerEngine({ speed: 2 }));
  const [note, setNote] = useState<string>();

  const deposit = async () => {
    const [pool] = engine.pools;
    if (!pool) {
      return;
    }
    const made = await engine.createNote(pool);
    // A real engine reads the deposit from the chain. The mock is told.
    engine.simulate.deposit(made.commitment);
    engine.simulate.crowd(made.pool, 40);
    setNote(made.note);
  };

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => void deposit()}>
          Make a deposited note
        </Button>
        <Button variant="outline" size="sm" onClick={() => engine.simulate.failNextProof()}>
          Fail the next proof
        </Button>
      </div>
      {/* Mock notes are worth nothing, so this one may be shown. */}
      {note && <p className="font-mono text-xs break-all">{note}</p>}
      <MixerWithdrawForm
        engine={engine}
        onSubmitted={(_, withdrawal) => engine.simulate.withdrawn(withdrawal)}
      />
    </div>
  );
}
