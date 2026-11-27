import { parseUnits } from "viem";
import { ApproveButton } from "@/components/approve-button";
import { TransactionButton } from "@/components/transaction-button";
import { demoAccounts } from "./wagmi-config";
import { demoUsdc } from "./tokens";
import { demo } from "./demo";

// Uniswap's universal router, as an example spender.
const router = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af";

export const Default = demo(() => (
  <ApproveButton token={demoUsdc} spender={router} amount={parseUnits("100", 6)} chainId={1}>
    <TransactionButton chainId={1} transaction={{ to: demoAccounts[1] }}>
      Swap 100 USDC
    </TransactionButton>
  </ApproveButton>
));
