import { useConnection } from "wagmi";
import { AddToken } from "@/components/add-token";
import { ConnectWallet } from "@/components/connect-wallet";

const usdc = {
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  symbol: "USDC",
  decimals: 6,
  logoURI:
    "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png",
} as const;

export default function AddTokenDemo() {
  const { isConnected } = useConnection();
  return isConnected ? <AddToken token={usdc} /> : <ConnectWallet />;
}
