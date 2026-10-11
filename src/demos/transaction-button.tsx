import { parseEther } from "viem";
import { TransactionButton } from "@/components/transaction-button";
import { demoAccounts, demoRevertAddress } from "./wagmi-config";
import { demo } from "./demo";

export const Default = demo(() => (
  <TransactionButton
    chainId={1}
    transaction={{ to: demoAccounts[1], value: parseEther("0.01") }}
  >
    Send 0.01 ETH
  </TransactionButton>
));

export const Reverted = demo(() => (
  <TransactionButton
    chainId={1}
    variant="outline"
    transaction={{ to: demoRevertAddress, value: parseEther("0.01") }}
  >
    Send (will revert)
  </TransactionButton>
));

export const WrongNetwork = demo(() => (
  <TransactionButton
    chainId={8453}
    transaction={{ to: demoAccounts[1], value: parseEther("0.01") }}
  >
    Send on Base
  </TransactionButton>
));

export const Blocked = demo(() => (
  <TransactionButton
    chainId={1}
    disabledReason="Enter an amount"
    transaction={{ to: demoAccounts[1] }}
  >
    Send
  </TransactionButton>
));
