import { useState } from "react";
import { Mixer } from "@/components/mixer";
import { createMockMixerEngine } from "@/lib/mock-mixer-engine";

export default function MixerDemo() {
  const [engine] = useState(() => createMockMixerEngine({ speed: 2 }));
  return (
    <Mixer
      engine={engine}
      // The mock reads no chain, so it is told when a deposit or a wallet withdrawal was sent.
      onDeposited={(_, { commitment }) => engine.simulate.deposit(commitment)}
      onWithdrawn={(_, withdrawal) => engine.simulate.withdrawn(withdrawal)}
    />
  );
}
