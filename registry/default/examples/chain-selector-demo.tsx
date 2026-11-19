import { ChainSelector, ChainSelectorDialog } from "@/components/chain-selector";

export default function ChainSelectorDemo() {
  return (
    <div className="flex items-center gap-2">
      <ChainSelector />
      <ChainSelector iconOnly />
      <ChainSelectorDialog groupByNetwork />
    </div>
  );
}
