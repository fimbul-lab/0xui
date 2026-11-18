import { PrivacyBadge } from "@/components/privacy-badge";
import { demo } from "./demo";

export const Default = demo(() => (
  <div className="flex items-center gap-2">
    <PrivacyBadge privacy="private" />
    <PrivacyBadge privacy="public" />
  </div>
));

export const OnValues = demo(() => (
  <dl className="grid w-full max-w-xs grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 text-sm">
    <dt className="flex items-center gap-2">
      Shielded balance <PrivacyBadge privacy="private" />
    </dt>
    <dd className="tabular-nums">1.25 WETH</dd>
    <dt className="flex items-center gap-2">
      Wallet balance <PrivacyBadge privacy="public" />
    </dt>
    <dd className="tabular-nums">0.4 ETH</dd>
  </dl>
));

export const Inline = demo(() => (
  <p className="max-w-sm text-sm">
    Unshielding is a <PrivacyBadge privacy="public" variant="inline" /> action: the recipient and
    the amount show up on-chain. Sending inside the pool stays{" "}
    <PrivacyBadge privacy="private" variant="inline" />.
  </p>
));

export const IconOnly = demo(() => (
  <div className="flex items-center gap-2">
    <PrivacyBadge privacy="private" iconOnly />
    <PrivacyBadge privacy="public" iconOnly />
  </div>
));

export const CustomLabel = demo(() => (
  <div className="flex items-center gap-2">
    <PrivacyBadge privacy="private">Shielded</PrivacyBadge>
    <PrivacyBadge privacy="public">Public exit</PrivacyBadge>
  </div>
));
