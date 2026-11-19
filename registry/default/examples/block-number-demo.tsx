import { BlockNumber } from "@/components/block-number";

export default function BlockNumberDemo() {
  return (
    <div className="flex flex-col items-center gap-2">
      <BlockNumber />
      <BlockNumber chainId={1} explorer />
    </div>
  );
}
