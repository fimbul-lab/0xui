import { ShieldedAddress } from "@/components/shielded-address";
import { useShieldedAccount } from "@/components/shielded-provider";
import { demo } from "./demo";
import { quickStart, shieldedDemo } from "./shielded-demo";

/** Shaped like a Railgun address: `0zk`, 127 characters. Not a real account. */
const address =
  "0zk1qyk9nw8x3ldf6h2mva7c5e0s4jtpzr9gq8xw3ldyk9nf6h2mva7c5e0s4jtpzr9gq8xw3ldyk9nf6h2mva7c5e0s4jtpzr9gq8xw3ldyk9nf6h2mva7c5e0s4jt";

export const Default = demo(() => <ShieldedAddress address={address} />);

export const Pill = demo(() => <ShieldedAddress address={address} variant="pill" />);

export const Full = demo(() => (
  <ShieldedAddress
    address={address}
    truncate={false}
    variant="pill"
    className="max-w-sm py-2 text-xs"
  />
));

export const FromAccount = shieldedDemo(
  function AccountAddress() {
    const { status, address } = useShieldedAccount();
    return address ? (
      <ShieldedAddress address={address} variant="pill" />
    ) : (
      <span className="text-sm text-muted-foreground">
        {status === "locked" ? "Unlocking…" : "No private account"}
      </span>
    );
  },
  { timings: quickStart },
);
