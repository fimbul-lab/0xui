import { Balance } from "@/components/balance";

const vitalik = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

export default function BalanceDemo() {
  return (
    <div className="flex flex-col items-center gap-2">
      <Balance />
      <Balance address={vitalik} chainId={1} />
      <Balance address={vitalik} token={usdc} chainId={1} price={1} />
    </div>
  );
}
