import { AddressAvatar } from "@/components/address-avatar";
import { demoAccounts } from "./wagmi-config";
import { demo } from "./demo";

export const Default = demo(() => (
  <div className="flex items-center gap-3">
    <AddressAvatar address={demoAccounts[0]} size={40} />
    <AddressAvatar address={demoAccounts[1]} size={40} />
    <AddressAvatar address="0x000000000000000000000000000000000000dEaD" size={40} />
  </div>
));
