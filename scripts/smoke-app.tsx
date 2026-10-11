// Copied into the smoke-test app as src/App.tsx. Render every component here
// so the build fails if an installed component doesn't compile.
import { erc20Abi, parseEther, parseUnits } from "viem";
import { Account } from "@/components/account";
import { Address } from "@/components/address";
import { AddressAvatar } from "@/components/address-avatar";
import { Balance } from "@/components/balance";
import { BlockNumber } from "@/components/block-number";
import { ChainBadge } from "@/components/chain-badge";
import { ChainSelector, ChainSelectorDialog } from "@/components/chain-selector";
import { ConnectWallet } from "@/components/connect-wallet";
import { CopyButton } from "@/components/copy-button";
import { ExplorerLink } from "@/components/explorer-link";
import { GasPrice } from "@/components/gas-price";
import { TokenAmount } from "@/components/token-amount";
import { TokenIcon } from "@/components/token-icon";
import { TransactionButton } from "@/components/transaction-button";
import { TransactionStatus } from "@/components/transaction-status";
import { WalletButton } from "@/components/wallet-button";
import { Web3Provider } from "@/components/web3-provider";

const address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

export default function App() {
  return (
    <Web3Provider>
      <WalletButton />
      <ConnectWallet />
      <Account showBalance />
      <ChainSelector chainMeta={(chain) => chain.name} />
      <ChainSelectorDialog groupByNetwork />
      <Balance />
      <Balance token={usdc} address={address} />
      <TransactionButton chainId={1} transaction={{ to: address, value: parseEther("0.01") }}>
        Send
      </TransactionButton>
      <TransactionButton
        chainId={1}
        contract={{ address: usdc, abi: erc20Abi, functionName: "approve", args: [address, 1n] }}
      >
        Approve
      </TransactionButton>
      <TransactionStatus hash={`0x${"ab".repeat(32)}`} chainId={1} />
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
