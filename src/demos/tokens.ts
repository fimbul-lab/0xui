import { NATIVE_TOKEN_ADDRESS, type Token } from "@/components/token-select";

/** A small token list for demos, in the Uniswap token list format. */
export const demoTokens: Token[] = [
  { chainId: 1, address: NATIVE_TOKEN_ADDRESS, symbol: "ETH", name: "Ether", decimals: 18 },
  { chainId: 1, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", name: "USD Coin", decimals: 6 },
  { chainId: 1, address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", name: "Tether USD", decimals: 6 },
  { chainId: 1, address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", symbol: "DAI", name: "Dai Stablecoin", decimals: 18 },
  { chainId: 1, address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
  { chainId: 1, address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", symbol: "WBTC", name: "Wrapped BTC", decimals: 8 },
  { chainId: 1, address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", symbol: "UNI", name: "Uniswap", decimals: 18 },
  { chainId: 1, address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", symbol: "LINK", name: "Chainlink", decimals: 18 },
  { chainId: 1, address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", symbol: "AAVE", name: "Aave", decimals: 18 },
  { chainId: 8453, address: NATIVE_TOKEN_ADDRESS, symbol: "ETH", name: "Ether", decimals: 18 },
  { chainId: 8453, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", name: "USD Coin", decimals: 6 },
];

export const demoUsdc = demoTokens[1]!;
export const demoEth = demoTokens[0]!;
