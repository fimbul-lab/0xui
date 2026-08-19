import { ChainSelectorDialog as ChainSelectorDialogReact } from "@registry/default/chain-selector/chain-selector";
import { WagmiDemo } from "@/lib/config/wagmi-provider";

interface ChainSelectorDialogWithProviderProps {
  iconOnly?: boolean;
  groupByNetwork?: boolean;
}

export function ChainSelectorDialogWithProvider({ iconOnly, groupByNetwork }: ChainSelectorDialogWithProviderProps) {
  return (
    <WagmiDemo>
      <ChainSelectorDialogReact iconOnly={iconOnly} groupByNetwork={groupByNetwork} />
    </WagmiDemo>
  );
}
