import { ExplorerLink } from "@/components/explorer-link";

export default function ExplorerLinkDemo() {
  return (
    <div className="flex flex-col items-center gap-2">
      <ExplorerLink address="0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" />
      <ExplorerLink block={21_000_000} chainId={1}>
        Block 21,000,000
      </ExplorerLink>
    </div>
  );
}
