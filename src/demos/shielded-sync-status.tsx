import { ShieldedSyncStatus } from "@/components/shielded-sync-status";
import { Button } from "@/components/ui/button";
import { shieldedDemo } from "./shielded-demo";

export const Default = shieldedDemo(
  function FirstScan({ engine, restart }) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-4">
        <ShieldedSyncStatus chainId={1} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={restart}>
            Start over
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              engine.simulate.failNextSync();
              void engine.sync(1);
            }}
          >
            Fail the next scan
          </Button>
        </div>
      </div>
    );
  },
  // Four times faster than the 40 s a first scan really takes.
  { speed: 4 }
);

export const Failed = shieldedDemo(
  () => <ShieldedSyncStatus chainId={1} className="max-w-sm" />,
  { speed: 4, setup: (engine) => engine.simulate.failNextSync("RPC returned 429: too many requests.") }
);

export const Inline = shieldedDemo(() => <ShieldedSyncStatus chainId={1} variant="inline" />, {
  speed: 4,
});
