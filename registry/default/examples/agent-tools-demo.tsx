import { AgentTools } from "@/components/agent-tools";
import { WalletButton } from "@/components/wallet-button";

export default function AgentToolsDemo() {
  return (
    <div className="flex flex-col items-center gap-2">
      <AgentTools />
      <WalletButton />
      <p className="max-w-xs text-center text-sm text-pretty text-muted-foreground">
        Browser agents can now read and use this page and the wallet. They ask you before
        connecting, switching networks or sending.
      </p>
    </div>
  );
}
