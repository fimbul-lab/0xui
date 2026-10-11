import { useState } from "react";
import { parseEther, type Hash } from "viem";
import { useConnection } from "wagmi";
import { Balance } from "@/components/balance";
import { BlockNumber } from "@/components/block-number";
import { ChainSelector } from "@/components/chain-selector";
import { TransactionButton } from "@/components/transaction-button";
import { TransactionStatus } from "@/components/transaction-status";
import { WalletButton } from "@/components/wallet-button";
import { demoAccounts } from "./wagmi-config";
import { demo } from "./demo";

export const HelloDapp = demo(function HelloDapp() {
  const { address } = useConnection();
  const [hash, setHash] = useState<Hash>();

  return (
    <div className="flex w-full max-w-md flex-col gap-6 rounded-2xl border p-5">
      <header className="flex items-center justify-between gap-2">
        <span className="font-semibold">Hello dapp</span>
        <div className="flex items-center gap-2">
          <ChainSelector iconOnly />
          <WalletButton />
        </div>
      </header>

      <section className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">Your balance</span>
        {address ? (
          <Balance className="text-3xl font-semibold" />
        ) : (
          <span className="text-3xl font-semibold text-muted-foreground">—</span>
        )}
      </section>

      <TransactionButton
        chainId={1}
        transaction={{ to: demoAccounts[1], value: parseEther("0.01") }}
        onSubmitted={setHash}
        hideStatus
        className="w-full [&>button]:w-full"
      >
        Send 0.01 ETH
      </TransactionButton>

      {hash && <TransactionStatus hash={hash} chainId={1} />}

      <footer className="flex justify-end">
        <BlockNumber chainId={1} />
      </footer>
    </div>
  );
});
