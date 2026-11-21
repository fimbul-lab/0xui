import { FeeTierSelect, defaultFeeTiers } from "@/components/fee-tier-select";
import { demo } from "./demo";

export const Default = demo(() => (
  <div className="w-full max-w-2xl">
    <FeeTierSelect />
  </div>
));

const shares = [0.02, 0.71, 0.27, undefined];

export const WithShares = demo(() => (
  <div className="w-full max-w-2xl">
    <FeeTierSelect
      defaultValue={500}
      tiers={defaultFeeTiers.map((tier, i) => ({ ...tier, share: shares[i], exists: shares[i] !== undefined }))}
    />
  </div>
));
