// Copied into the smoke-test app as src/App.tsx. Render every component here
// so the build fails if an installed component doesn't compile.
import { erc20Abi, parseEther, parseUnits } from "viem";
import { useState } from "react";
import { Account } from "@/components/account";
import { BatchTransaction } from "@/components/batch-transaction";
import { ContractForm } from "@/components/contract-form";
import { EnsProfile } from "@/components/ens-profile";
import { EventFeed } from "@/components/event-feed";
import { NftCard } from "@/components/nft-card";
import { Portfolio } from "@/components/portfolio";
import { Send } from "@/components/send";
import { Swap } from "@/components/swap";
import { TransactionHistory, recordTransaction } from "@/components/transaction-history";
import { AddToken } from "@/components/add-token";
import { AddressInput } from "@/components/address-input";
import { AmountInput } from "@/components/amount-input";
import { ApproveButton } from "@/components/approve-button";
import { NetworkGuard } from "@/components/network-guard";
import { SignMessage } from "@/components/sign-message";
import { TokenInput } from "@/components/token-input";
import { NATIVE_TOKEN_ADDRESS, TokenSelect } from "@/components/token-select";
import type { Token } from "@/components/token-select";
import { useTransactionToast } from "@/components/transaction-toast";
import { Toaster } from "@/components/primitives/toast";
import { useTokenList } from "@/hooks/use-token-list";
import { UNISWAP_DEFAULT_LIST } from "@/lib/token-list";
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
import { PrivacyBadge } from "@/components/privacy-badge";
import { ProofProgress, useProof } from "@/components/proof-progress";
import { Shield } from "@/components/shield";
import { ShieldedAccount } from "@/components/shielded-account";
import { ShieldedAddress } from "@/components/shielded-address";
import { ShieldedBalance } from "@/components/shielded-balance";
import { ShieldedProvider, useShieldedAccount } from "@/components/shielded-provider";
import { ShieldedSyncStatus } from "@/components/shielded-sync-status";
import { ShieldedTransactionStatus } from "@/components/shielded-transaction-status";
import { createMockShieldedEngine } from "@/lib/mock-shielded-engine";

const address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const tokens: Array<Token> = [
  { chainId: 1, address: NATIVE_TOKEN_ADDRESS, symbol: "ETH", name: "Ether", decimals: 18 },
  { chainId: 1, address: usdc, symbol: "USDC", name: "USD Coin", decimals: 6 },
];

function Phase3() {
  const uniswap = useTokenList(UNISWAP_DEFAULT_LIST);
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState<Token>(tokens[0]!);
  const [recipient, setRecipient] = useState("");
  const toastTransaction = useTransactionToast();
  return (
    <>
      <AmountInput value={amount} onValueChange={setAmount} decimals={18} />
      <TokenSelect
        tokens={uniswap.tokens}
        isLoading={uniswap.isLoading}
        value={token}
        onValueChange={setToken}
      />
      <TokenInput
        value={amount}
        onValueChange={setAmount}
        token={token}
        onTokenChange={setToken}
        tokens={tokens}
      />
      <AddressInput value={recipient} onValueChange={setRecipient} onResolve={(s) => s.address} />
      <ApproveButton
        token={{ address: usdc, symbol: "USDC" }}
        spender={address}
        amount={1n}
        chainId={1}
      >
        <TransactionButton
          chainId={1}
          transaction={{ to: address }}
          onSubmitted={(hash) => toastTransaction(hash)}
        >
          Go
        </TransactionButton>
      </ApproveButton>
      <NetworkGuard chainId={1}>Guarded</NetworkGuard>
      <SignMessage message="hello" verify />
      <AddToken token={{ address: usdc, symbol: "USDC", decimals: 6 }} />
      <Toaster />
    </>
  );
}

const shieldedEngine = createMockShieldedEngine({ funds: [{ token: usdc, amount: 1_000_000n }] });

function Shielded() {
  const account = useShieldedAccount();
  const proof = useProof();
  return (
    <>
      <button onClick={() => shieldedEngine.account.unlock("password")}>Unlock</button>
      {account.address && <ShieldedAddress address={account.address} variant="pill" />}
      <PrivacyBadge privacy="private" />
      <PrivacyBadge privacy="public" variant="inline" iconOnly />
      <ShieldedBalance
        token={{ address: usdc, symbol: "USDC", decimals: 6 }}
        chainId={1}
        price={1}
      />
      <ShieldedBalance
        token={{ address: usdc, symbol: "USDC", decimals: 6 }}
        chainId={1}
        variant="inline"
      />
      <ShieldedSyncStatus chainId={1} />
      <ShieldedSyncStatus chainId={1} variant="inline" />
      <button
        onClick={() =>
          proof.prove({ kind: "unshield", chainId: 1, token: usdc, amount: 1n, recipient: address })
        }
      >
        Prove
      </button>
      <ProofProgress
        phase={proof.phase}
        stage={proof.stage}
        error={proof.error}
        onCancel={proof.cancel}
      />
      <ShieldedAccount>
        <Shield
          tokens={tokens}
          chainId={1}
          onSubmitted={(hash, draft) => shieldedEngine.simulate.shield({ ...draft, hash })}
        />
        <Shield tokens={tokens} chainId={1} variant="collapse" />
      </ShieldedAccount>
      <ShieldedAccount />
      <ShieldedTransactionStatus hash={`0x${"ab".repeat(32)}`} chainId={1} standby={60} />
      <ShieldedTransactionStatus hash={`0x${"ab".repeat(32)}`} chainId={1} variant="line" />
      <AddressInput value="" onValueChange={() => {}} shielded />
    </>
  );
}

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
      <Phase3 />
      <Send tokens={tokens} />
      <Swap
        tokens={tokens}
        getQuote={async ({ sellAmount }) => ({
          buyAmount: sellAmount,
          transaction: { to: address },
        })}
      />
      <BatchTransaction chainId={1} calls={[{ to: address }, { to: usdc, data: "0x" }]} />
      <ContractForm address={usdc} abi={erc20Abi} show="read" />
      <Portfolio tokens={tokens} prices={{ ETH: 3000 }} />
      <TransactionHistory />
      <button onClick={() => recordTransaction({ hash: `0x${"ab".repeat(32)}`, chainId: 1 })}>
        Record
      </button>
      <EnsProfile name="vitalik.eth" />
      <NftCard contract={address} tokenId={1n} />
      <EventFeed address={usdc} abi={erc20Abi} eventName="Transfer" />
      <ShieldedProvider engine={shieldedEngine}>
        <Shielded />
      </ShieldedProvider>
    </Web3Provider>
  );
}
