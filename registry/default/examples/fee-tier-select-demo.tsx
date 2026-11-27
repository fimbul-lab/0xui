import { FeeTierSelect, defaultFeeTiers } from "@/components/fee-tier-select";

const shares = [0.02, 0.71, 0.27, undefined];

export default function FeeTierSelectDemo() {
  return (
    <div className="w-full max-w-2xl">
      <FeeTierSelect
        defaultValue={500}
        tiers={defaultFeeTiers.map((tier, i) => ({
          ...tier,
          share: shares[i],
          exists: shares[i] !== undefined,
        }))}
      />
    </div>
  );
}
