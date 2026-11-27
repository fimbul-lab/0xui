import { useState } from "react";
import { Mixer } from "@/components/mixer";
import { TORNADO_SEPOLIA_POOLS, createTornadoEngine } from "@/lib/tornado-engine";

// Sepolia: real contracts, test funds.
const chainId = 11_155_111;
// A withdrawal reads the pool's deposits back to its deployment, so the RPC must serve old logs.
const rpcUrl = "https://sepolia.gateway.tenderly.co";

export default function TornadoEngineDemo() {
  const [engine] = useState(() =>
    createTornadoEngine({
      pools: TORNADO_SEPOLIA_POOLS,
      chains: { [chainId]: { rpcUrl } },
      // Host tornado.json and tornadoProvingKey.bin here. Needed to withdraw, not to deposit.
      circuitsUrl: "/tornado",
    }),
  );
  // Deposits are real. Save the note: it is the only way back to the funds.
  return <Mixer engine={engine} />;
}
