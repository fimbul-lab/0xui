import { GasPrice } from "@/components/gas-price";

export default function GasPriceDemo() {
  return (
    <div className="flex flex-col items-center gap-2">
      <GasPrice />
      <GasPrice chainId={1} thresholds={{ low: 5, high: 30 }} />
    </div>
  );
}
