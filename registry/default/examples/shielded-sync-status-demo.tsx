import { useEffect, useState } from "react";
import { ShieldedProvider } from "@/components/shielded-provider";
import { ShieldedSyncStatus } from "@/components/shielded-sync-status";
import { createMockShieldedEngine } from "@/lib/mock-shielded-engine";

export default function ShieldedSyncStatusDemo() {
  const [engine] = useState(() => createMockShieldedEngine({ speed: 4 }));
  useEffect(() => {
    void engine.account.unlock("password");
    return () => engine.account.lock();
  }, [engine]);
  return (
    <ShieldedProvider engine={engine}>
      <div className="flex w-full max-w-sm flex-col gap-4">
        <ShieldedSyncStatus chainId={1} />
        <ShieldedSyncStatus chainId={1} variant="inline" />
      </div>
    </ShieldedProvider>
  );
}
