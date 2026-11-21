// Locale pinned so the server and the browser format numbers the same way.
import { FeeTierSelect, defaultFeeTiers } from "@/components/fee-tier-select";
import { demo } from "./demo";
import { usePretendLoad } from "./use-pretend-load";

export const Default = demo(() => (
  <div className="w-full max-w-2xl">
    <FeeTierSelect locale="en-US" />
  </div>
));

const shares = [0.02, 0.71, 0.27, undefined];

export const WithShares = demo(() => {
  const loaded = usePretendLoad();
  return (
    <div className="w-full max-w-2xl">
      <FeeTierSelect locale="en-US"
        loading={!loaded}
        defaultValue={500}
        tiers={defaultFeeTiers.map((tier, i) => ({
          ...tier,
          share: shares[i],
          exists: shares[i] !== undefined,
        }))}
      />
    </div>
  );
});
