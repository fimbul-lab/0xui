import { AgentTools } from "@/components/agent-tools";
import { WalletButton } from "@/components/wallet-button";

export default function AgentToolsDemo() {
  return (
    <div className="flex flex-col items-center gap-2">
      <AgentTools />
      <WalletButton />
      <p className="text-sm text-muted-foreground">
        Browser agents can now read the wallet, its balances and chains.
      </p>
    </div>
  );
}
