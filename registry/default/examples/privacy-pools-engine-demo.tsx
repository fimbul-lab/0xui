import { useState } from "react";
import { Shield } from "@/components/shield";
import { ShieldedAccount } from "@/components/shielded-account";
import { ShieldedBalance } from "@/components/shielded-balance";
import { ShieldedProvider } from "@/components/shielded-provider";
import { ShieldedSyncStatus } from "@/components/shielded-sync-status";
import {
  PRIVACY_POOLS_NATIVE,
  PRIVACY_POOLS_SEPOLIA,
  createPrivacyPoolsEngine,
} from "@/lib/privacy-pools-engine";

// Sepolia: real contracts, test funds.
const chainId = 11155111;
// The scan reads logs back to the pools' deployment, so the RPC must serve old logs.
const rpcUrl = "https://sepolia.gateway.tenderly.co";

const eth = {
  chainId,
  address: PRIVACY_POOLS_NATIVE,
  name: "Ether",
  symbol: "ETH",
  decimals: 18,
} as const;
const usdc = {
  chainId,
  address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  name: "USDC",
  symbol: "USDC",
  decimals: 6,
} as const;

export default function PrivacyPoolsEngineDemo() {
  const [engine] = useState(() =>
    createPrivacyPoolsEngine({ chains: { [chainId]: { ...PRIVACY_POOLS_SEPOLIA, rpcUrl } } }),
  );
  return (
    <ShieldedProvider engine={engine}>
      {/* Creates a real account. Save the recovery phrase: it is the only way back to the funds. */}
      <ShieldedAccount>
        <div className="flex w-full max-w-md flex-col gap-4">
          <ShieldedSyncStatus chainId={chainId} />
          <Shield tokens={[eth, usdc]} chainId={chainId} popular={["ETH", "USDC"]} />
          <div className="grid gap-3 sm:grid-cols-2">
            <ShieldedBalance token={eth} chainId={chainId} />
            <ShieldedBalance token={usdc} chainId={chainId} />
          </div>
        </div>
      </ShieldedAccount>
    </ShieldedProvider>
  );
}
