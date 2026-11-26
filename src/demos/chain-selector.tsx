import { ChainSelector, ChainSelectorDialog } from "@/components/chain-selector";
import { demo } from "./demo";

export const Default = demo(() => <ChainSelector />);

export const IconOnly = demo(() => <ChainSelector iconOnly />);

export const Dialog = demo(() => <ChainSelectorDialog />);

export const GroupByNetwork = demo(() => <ChainSelector groupByNetwork />);

export const Branded = demo(() => <ChainSelector variant="branded" />);
