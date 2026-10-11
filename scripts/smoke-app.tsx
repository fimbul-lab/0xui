// Copied into the smoke-test app as src/App.tsx. Render every component here
// so the build fails if an installed component doesn't compile.
import { ChainSelector, ChainSelectorDialog } from "@/components/chain-selector";
import { Web3Provider } from "@/components/web3-provider";

export default function App() {
  return (
    <Web3Provider>
      <ChainSelector />
      <ChainSelectorDialog groupByNetwork />
    </Web3Provider>
  );
}
