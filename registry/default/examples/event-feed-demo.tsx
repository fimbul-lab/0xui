import { erc20Abi } from "viem";
import { EventFeed } from "@/components/event-feed";

const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

export default function EventFeedDemo() {
  return (
    <EventFeed
      title="USDC transfers on Ethereum"
      address={usdc}
      abi={erc20Abi}
      eventName="Transfer"
      chainId={1}
      historyBlocks={1}
      max={8}
      className="w-full max-w-lg"
    />
  );
}
