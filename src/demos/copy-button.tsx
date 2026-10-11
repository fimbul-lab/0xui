import { CopyButton } from "@/components/copy-button";
import { demo } from "./demo";

export const Default = demo(() => (
  <CopyButton value="0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" label="Copy address" />
));

export const Outline = demo(() => (
  <CopyButton value="0x5f3b…" label="Copy transaction hash" variant="outline" size="icon" />
));
