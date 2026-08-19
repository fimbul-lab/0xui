import React from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "./wagmi-config";

const queryClient = new QueryClient();

export function WagmiDemo({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <div className="not-content">{children}</div>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
