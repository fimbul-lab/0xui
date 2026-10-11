import { ChainBadge } from "@/components/chain-badge";
import { demo } from "./demo";

export const Default = demo(() => (
  <div className="flex flex-wrap justify-center gap-2">
    <ChainBadge chainId={1} />
    <ChainBadge chainId={8453} />
    <ChainBadge chainId={11155111} />
    <ChainBadge chainId={424242} />
  </div>
));

export const IconOnly = demo(() => (
  <div className="flex gap-2">
    <ChainBadge chainId={1} iconOnly />
    <ChainBadge chainId={8453} iconOnly variant="branded" />
  </div>
));
