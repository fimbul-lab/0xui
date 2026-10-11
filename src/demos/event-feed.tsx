import { erc20Abi } from "viem";
import { EventFeed } from "@/components/event-feed";
import { demoUsdc } from "./tokens";
import { demo } from "./demo";

export const Default = demo(() => (
  <EventFeed
    title="USDC transfers on Ethereum"
    address={demoUsdc.address}
    abi={erc20Abi}
    eventName="Transfer"
    chainId={1}
    historyBlocks={1}
    max={8}
    className="w-full max-w-lg"
  />
));
