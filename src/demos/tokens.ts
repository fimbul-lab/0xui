import { mainnet } from "wagmi/chains";
import { useTokenList } from "@/hooks/use-token-list";
import { UNISWAP_DEFAULT_LIST, nativeToken, type TokenInfo } from "@/lib/token-list";

/** Uniswap Labs' default token list, live, for one chain plus its native currency. */
export function useDemoTokens(chainId = mainnet.id) {
  return useTokenList(UNISWAP_DEFAULT_LIST, { chainId });
}

export const demoEth = nativeToken(mainnet);

/** USDC on Ethereum, as listed in Uniswap's default list. For demos that need one fixed token. */
export const demoUsdc: TokenInfo = {
  chainId: 1,
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  name: "USDCoin",
  symbol: "USDC",
  decimals: 6,
  logoURI:
    "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png",
};
