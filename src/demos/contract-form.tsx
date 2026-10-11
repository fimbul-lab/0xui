import { erc20Abi } from "viem";
import { ContractForm } from "@/components/contract-form";
import { demoUsdc } from "./tokens";
import { demo } from "./demo";

export const Default = demo(() => (
  <ContractForm
    address={demoUsdc.address}
    abi={erc20Abi}
    chainId={1}
    functions={["name", "balanceOf", "allowance", "transfer", "approve"]}
    className="w-full max-w-lg"
  />
));
