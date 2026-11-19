import { EnsProfile } from "@/components/ens-profile";

export default function EnsProfileDemo() {
  return (
    <div className="flex flex-col gap-4">
      <EnsProfile name="vitalik.eth" />
      <EnsProfile address="0x983110309620D911731Ac0932219af06091b6744" />
    </div>
  );
}
