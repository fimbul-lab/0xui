import { Address } from "@/components/address";
import { demoAccounts } from "./wagmi-config";
import { demo } from "./demo";

export const Default = demo(() => <Address address={demoAccounts[0]} />);

export const NoEns = demo(() => <Address address={demoAccounts[0]} ens={false} explorer />);

export const Pill = demo(() => <Address address={demoAccounts[1]} variant="pill" />);
