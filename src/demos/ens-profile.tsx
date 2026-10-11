import { EnsProfile } from "@/components/ens-profile";
import { demo } from "./demo";

export const Default = demo(() => <EnsProfile name="vitalik.eth" />);

export const ByAddress = demo(() => (
  <EnsProfile address="0x983110309620D911731Ac0932219af06091b6744" />
));
