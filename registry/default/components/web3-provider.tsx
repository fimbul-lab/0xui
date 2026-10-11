import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider, type Config, type State } from "wagmi";
import { config as defaultConfig } from "@/lib/wagmi-config";

export type Web3ProviderProps = {
  children: ReactNode;
  /** wagmi config. Defaults to the one in `lib/wagmi-config`. */
  config?: Config;
  /** Initial wagmi state from `cookieToInitialState`, for SSR. */
  initialState?: State;
};

/** wagmi + TanStack Query providers. Wrap your app (or the part that uses wallets) once. */
export function Web3Provider({
  children,
  config = defaultConfig,
  initialState,
}: Web3ProviderProps) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
