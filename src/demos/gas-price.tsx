import { GasPrice } from "@/components/gas-price";
import { demo } from "./demo";

export const Default = demo(() => <GasPrice chainId={1} />);

export const WithThresholds = demo(() => (
  <GasPrice chainId={1} thresholds={{ low: 5, high: 30 }} />
));
