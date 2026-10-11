// Copied into the smoke-test app as src/App.tsx. Render every component here
// so the build fails if an installed component doesn't compile.
import { parseUnits } from "viem";
import { Address } from "@/components/address";
import { AddressAvatar } from "@/components/address-avatar";
import { BlockNumber } from "@/components/block-number";
import { ChainBadge } from "@/components/chain-badge";
import { ChainSelector, ChainSelectorDialog } from "@/components/chain-selector";
import { CopyButton } from "@/components/copy-button";
import { ExplorerLink } from "@/components/explorer-link";
import { GasPrice } from "@/components/gas-price";
import { TokenAmount } from "@/components/token-amount";
import { TokenIcon } from "@/components/token-icon";
import { Web3Provider } from "@/components/web3-provider";

const address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

export default function App() {
  return (
    <Web3Provider>
      <ChainSelector />
      <ChainSelectorDialog groupByNetwork />
      <CopyButton value={address} label="Copy address" />
      <ExplorerLink address={address} />
      <Address address={address} explorer variant="pill" />
      <AddressAvatar address={address} size={32} />
      <ChainBadge chainId={1} />
      <TokenIcon symbol="USDC" chainId={1} />
      <TokenAmount value={parseUnits("1.5", 6)} decimals={6} symbol="USDC" price={1} />
      <BlockNumber explorer />
      <GasPrice thresholds={{ low: 5, high: 30 }} />
    </Web3Provider>
  );
}
