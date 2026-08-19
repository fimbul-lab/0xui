import { createConfig, http } from "wagmi";
import {
  mainnet,
  sepolia,
  base,
  unichain,
  sonic,
  berachain,
  pulsechain,
  monad,
} from "wagmi/chains";

export const config = createConfig({
  chains: [
    mainnet,
    sepolia,
    base,
    unichain,
    sonic,
    berachain,
    pulsechain,
    monad,
  ],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
    [base.id]: http(),
    [unichain.id]: http(),
    [sonic.id]: http(),
    [berachain.id]: http(),
    [pulsechain.id]: http(),
    [monad.id]: http(),
  },
});
