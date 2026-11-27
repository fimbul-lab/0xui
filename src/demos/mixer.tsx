import { useState } from "react";
import { ConnectWallet } from "@/components/connect-wallet";
import { Mixer } from "@/components/mixer";
import { NoteBackup } from "@/components/note-backup";
import { createMockMixerEngine } from "@/lib/mock-mixer-engine";
import { demo } from "./demo";
import { demoAccounts, sendDemoTransaction } from "./wagmi-config";

/** The whole block on the mock engine: deposit, keep the note, paste it under Withdraw. */
export const Default = demo(function MixerDemo() {
  const [engine] = useState(() =>
    createMockMixerEngine({
      timings: { sync: 2500, loadCircuits: 2000, prove: 4000 },
      // A real relayer sends a real transaction. This one is made up, and the demo chain mines it.
      relay: (withdrawal) =>
        sendDemoTransaction({ from: demoAccounts[1], to: withdrawal.recipient }),
    }),
  );
  return (
    <>
      <Mixer
        engine={engine}
        // On a real chain the engine reads the deposit and the withdrawal. The mock is told.
        onDeposited={(_, { commitment }) => {
          engine.simulate.deposit(commitment);
          // Other people keep depositing, so the crowd is not empty.
          engine.simulate.crowd(engine.pools[0]!, 37);
        }}
        onWithdrawn={(_, withdrawal) => engine.simulate.withdrawn(withdrawal)}
      />
      <ConnectWallet variant="link" size="sm">
        Connect the Demo Wallet to deposit
      </ConnectWallet>
    </>
  );
});

/** The backup step on its own, with a made-up note. */
export const Backup = demo(function NoteBackupDemo() {
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <NoteBackup
        note={`mock-note-eth-0.1-1-0x${"3f9a".repeat(31)}`}
        saved={saved}
        onSavedChange={setSaved}
        fileName="note-0.1-ETH.txt"
      />
      <p className="text-sm text-muted-foreground">
        {saved ? "Saved: the next step opens." : "Not saved yet."}
      </p>
    </div>
  );
});
