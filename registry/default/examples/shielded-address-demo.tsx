import { ShieldedAddress } from "@/components/shielded-address";

const address =
  "0zk1qyk9nw8x3ldf6h2mva7c5e0s4jtpzr9gq8xw3ldyk9nf6h2mva7c5e0s4jtpzr9gq8xw3ldyk9nf6h2mva7c5e0s4jtpzr9gq8xw3ldyk9nf6h2mva7c5e0s4jt";

export default function ShieldedAddressDemo() {
  return (
    <div className="flex flex-col items-center gap-3">
      <ShieldedAddress address={address} />
      <ShieldedAddress address={address} variant="pill" />
    </div>
  );
}
