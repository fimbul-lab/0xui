import { erc20Abi } from "viem";
import { ContractForm } from "@/components/contract-form";

const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

export default function ContractFormDemo() {
  return (
    <ContractForm
      address={usdc}
      abi={erc20Abi}
      chainId={1}
      functions={["name", "balanceOf", "allowance", "transfer", "approve"]}
      className="w-full max-w-lg"
    />
  );
}
