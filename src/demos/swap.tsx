import { parseUnits } from "viem";
import { Swap, type GetQuote } from "@/components/swap";
import { isNativeToken } from "@/components/token-select";
import { ConnectWallet } from "@/components/connect-wallet";
import { demoPrices } from "./prices";
import { demoEth, demoUsdc, useDemoTokens } from "./tokens";
import { demo } from "./demo";

// Uniswap's universal router, as the spender. Demo swaps are never broadcast.
const router = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af";

/** A fake quote from fixed prices, with a 0.3% fee and a small delay. */
const getQuote: GetQuote = async ({ sellToken, buyToken, sellAmount }) => {
  await new Promise((r) => setTimeout(r, 600));
  const sellPrice = demoPrices[sellToken.symbol];
  const buyPrice = demoPrices[buyToken.symbol];
  if (!sellPrice || !buyPrice)
    throw new Error(`No demo price for ${sellPrice ? buyToken.symbol : sellToken.symbol}`);
  const sellUnits = Number(sellAmount) / 10 ** sellToken.decimals;
  const buyUnits = ((sellUnits * sellPrice) / buyPrice) * 0.997;
  return {
    buyAmount: parseUnits(buyUnits.toFixed(buyToken.decimals), buyToken.decimals),
    transaction: {
      to: router,
      data: "0x3593564c",
      value: isNativeToken(sellToken) ? sellAmount : 0n,
    },
    spender: isNativeToken(sellToken) ? undefined : router,
    priceImpact: Math.min((sellUnits * sellPrice) / 1_000_000, 20),
  };
};

export const Default = demo(function SwapDemo() {
  const { tokens } = useDemoTokens();
  return (
    <>
      <Swap
        tokens={tokens}
        defaultSellToken={demoEth}
        defaultBuyToken={demoUsdc}
        getQuote={getQuote}
        popular={["ETH", "USDC", "WBTC"]}
        prices={demoPrices}
      />
      <ConnectWallet variant="link" size="sm">
        Connect the Demo Wallet to use it
      </ConnectWallet>
    </>
  );
});
