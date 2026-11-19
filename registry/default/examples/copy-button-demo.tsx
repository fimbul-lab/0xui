import { CopyButton } from "@/components/copy-button";

const vitalik = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

export default function CopyButtonDemo() {
  return (
    <div className="flex items-center gap-2">
      <CopyButton value={vitalik} label="Copy address" />
      <CopyButton value={vitalik} label="Copy address" variant="outline" size="icon" />
    </div>
  );
}
