import type { ComponentType } from "react";
import { AgentTools } from "@/components/agent-tools";
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
 *
 * Every island renders AgentTools, so a WebMCP browser agent can drive the
 * page's demos. The first one registers the tools; the rest do nothing.
 * Steps on `data-agent-confirm` controls wait for "Allow" in its dialog.
 */
export function demo(Component: ComponentType) {
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- it renders `<Component />`; the rule misses JSX references.
  function Demo() {
    return (
      <Web3Provider config={demoConfig}>
        <div className="not-content flex flex-col items-center gap-2">
          <AgentTools />
          <Component />
        </div>
      </Web3Provider>
    );
  }
  Demo.displayName = `Demo(${Component.displayName ?? Component.name})`;
  return Demo;
}
