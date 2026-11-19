import { PrivacyBadge } from "@/components/privacy-badge";

export default function PrivacyBadgeDemo() {
  return (
    <div className="flex max-w-sm flex-col items-center gap-4">
      <div className="flex items-center gap-2">
        <PrivacyBadge privacy="private" />
        <PrivacyBadge privacy="public" />
        <PrivacyBadge privacy="private" iconOnly />
      </div>
      <p className="text-sm">
        Unshielding is a <PrivacyBadge privacy="public" variant="inline" /> action: the recipient
        and the amount show up on-chain. Sending inside the pool stays{" "}
        <PrivacyBadge privacy="private" variant="inline" />.
      </p>
    </div>
  );
}
