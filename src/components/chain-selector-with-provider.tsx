import { ChainSelector as ChainSelectorReact } from "@registry/default/chain-selector/chain-selector";
import { WagmiDemo } from "@/lib/config/wagmi-provider";

interface ChainSelectorWithProviderProps {
  iconOnly?: boolean;
  groupByNetwork?: boolean;
  variant?: "mono" | "branded" | "background";
}

export function ChainSelectorWithProvider({
  iconOnly,
  groupByNetwork,
  variant = "background",
}: ChainSelectorWithProviderProps) {
  return (
    <WagmiDemo>
      <ChainSelectorReact
        iconOnly={iconOnly}
        groupByNetwork={groupByNetwork}
        variant={variant}
      />
    </WagmiDemo>
  );
}
