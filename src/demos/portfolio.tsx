import { useEffect, useState } from "react";
import { parseUnits } from "viem";
import { Portfolio, type PortfolioHolding } from "@/components/portfolio";
import type { TokenInfo } from "@/lib/token-list";
import { demoPrices } from "./prices";
import { demoEth } from "./tokens";
import { demo } from "./demo";

const erc20 = (address: `0x${string}`, name: string, symbol: string, decimals = 18): TokenInfo => ({
  chainId: 1,
  address,
  name,
  symbol,
  decimals,
});

const wbtc = erc20("0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", "Wrapped BTC", "WBTC", 8);
const usdt = erc20("0xdAC17F958D2ee523a2206206994597C13D831ec7", "Tether USD", "USDT", 6);
const usdc = erc20("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "USDCoin", "USDC", 6);
const dai = erc20("0x6B175474E89094C44Da98b954EedeAC495271d0F", "Dai Stablecoin", "DAI");
const aave = erc20("0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", "Aave", "AAVE");
const uni = erc20("0x1f9840a85d5aF4bf1D1762F925BDADdC4201F984", "Uniswap", "UNI");
const shib = erc20("0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE", "Shiba Inu", "SHIB");
// Not real contracts: stand-ins for what an indexer returns besides the list.
const airdrop = erc20(
  "0x00000000000000000000000000000000000000A1",
  "Claim rewards at usd-bonus.io",
  "usd-bonus.io",
);
const unlisted = erc20("0x00000000000000000000000000000000000000A2", "Some Token", "SOME");

/** The token list: the allowlist. `shib` has no demo price, so it is hidden as unpriced. */
const tokens = [demoEth, wbtc, usdt, usdc, dai, aave, uni, shib];

/**
 * Fixed holdings, as an indexer would return them. The demo shows the layout
 * and the hidden-token rules; it doesn't need a live wallet, and with the
 * data known up front the skeleton has its exact shape, so nothing moves.
 */
const holdings: Array<PortfolioHolding> = [
  { token: demoEth, balance: parseUnits("5.7989", 18) },
  { token: wbtc, balance: parseUnits("0.0472", 8) },
  { token: usdt, balance: parseUnits("296.3682", 6) },
  { token: usdc, balance: parseUnits("39.1921", 6) },
  { token: dai, balance: parseUnits("14.372", 18) },
  { token: aave, balance: parseUnits("0.0101", 18) },
  { token: uni, balance: parseUnits("0.01", 18) }, // dust
  { token: shib, balance: parseUnits("1250000", 18) }, // no price
  { token: airdrop, balance: parseUnits("5000", 18) }, // spam
  { token: unlisted, balance: parseUnits("42", 18) }, // not on the list
];

export const Default = demo(function PortfolioDemo() {
  // A pretend load, so the skeleton shows before the same data is revealed.
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Portfolio
      tokens={tokens}
      holdings={holdings}
      isLoading={loading}
      prices={demoPrices}
      chainId={1}
      // Pinned so the server and the browser format amounts the same way.
      locale="en-US"
      title="vitalik.eth"
      className="w-full max-w-md"
    />
  );
});
