import { BlockNumber } from "@/components/block-number";
import { demo } from "./demo";

export const Default = demo(() => <BlockNumber chainId={1} />);

export const WithExplorer = demo(() => <BlockNumber chainId={8453} explorer />);
