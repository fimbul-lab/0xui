import { ExplorerLink } from "@/components/explorer-link";
import { demo } from "./demo";

export const Default = demo(() => (
  <ExplorerLink address="0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" />
));

export const CustomText = demo(() => (
  <ExplorerLink block={21_000_000} chainId={8453}>
    Block 21,000,000 on Base
  </ExplorerLink>
));
