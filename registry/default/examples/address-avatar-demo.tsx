import { AddressAvatar } from "@/components/address-avatar";

export default function AddressAvatarDemo() {
  return (
    <div className="flex items-center gap-3">
      <AddressAvatar address="0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" size={40} />
      <AddressAvatar address="0x983110309620D911731Ac0932219af06091b6744" size={40} />
      <AddressAvatar address="0x000000000000000000000000000000000000dEaD" size={40} />
    </div>
  );
}
