import type { ComponentType } from "react";
import { Web3Provider } from "@/components/web3-provider";
import { demoConfig } from "./wagmi-config";

/**
 * Wrap a demo so it can be hydrated as its own Astro island:
 *
 *   // src/demos/chain-selector.tsx
 *   export const IconOnly = demo(() => <ChainSelector iconOnly />);
 *
 *   // components/chain-selector.mdx
 *   <IconOnly client:load />
 */
export function demo(Component: ComponentType) {
  function Demo() {
    return (
      <Web3Provider config={demoConfig}>
        <div className="not-content flex flex-col items-center gap-2">
          <Component />
        </div>
      </Web3Provider>
    );
  }
  Demo.displayName = `Demo(${Component.displayName ?? Component.name})`;
  return Demo;
}
