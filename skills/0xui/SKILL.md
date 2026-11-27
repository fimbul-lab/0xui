---
name: 0xui
description: Builds web3 React UI from 0xui, a shadcn registry on wagmi, viem and ui-sdk. Use when adding wallet connect, balances, token or amount inputs, transactions, approvals, swaps, sends, liquidity positions or ENS display to a React app, or when components.json lists the @0xui registry.
---

# Build with 0xui

0xui components are copied into the app as source with the shadcn CLI. Each one handles the states real wallets produce (pending, cancelled in wallet, wrong network, error) and exports its hook.

## Read the page first

Every docs page has a Markdown version: append `.md` to its URL, like https://0xui.io/components/balance.md. Before you use a component, read its page: it has the install command, usage, props and the `data-phase` states. https://0xui.io/llms.txt lists every page. Each component also has a runnable example, `npx shadcn@latest add @0xui/<name>-demo`, and its props as JSON at https://0xui.io/props/<name>.json.

When the browser you're driving exposes WebMCP tools on 0xui.io (`search_docs`, `get_doc`, `get_registry_item`), use those instead of fetching pages.

## Set up once

1. The project needs Tailwind CSS v4 and shadcn (`npx shadcn@latest init`; Base UI or Radix both work). Put `@layer ui-sdk;` at the very top of the global stylesheet, above `@import "tailwindcss"`.
2. Add the registry to `components.json`:

   ```json
   { "registries": { "@0xui": "https://0xui.io/r/{name}.json" } }
   ```

3. If the app has no `WagmiProvider`, run `npx shadcn@latest add @0xui/wagmi-config` and wrap the app in the `Web3Provider` it adds. Edit `lib/wagmi-config.ts` for the app's chains.

Run every `add` with `--overwrite`. Without a terminal the CLI can stop at an "overwrite?" question, exit 0 and leave the install half done. `--overwrite` replaces local edits to the files it installs, so when the project has customized 0xui files, read `--dry-run` first.

An install is done when the item's own file exists, like `components/wallet-button.tsx` for `@0xui/wallet-button`.

## Pick a component

Prefer a block or component over hand-rolled wagmi calls: they already handle cancellation, wrong network and loading. When the design needs a different UI, import the component's hook and keep its logic.

| Need                                                                                                       | Item                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connect button for a header                                                                                | `wallet-button` (wraps `connect-wallet` and `account`)                                                                                                                                                |
| Wallet picker or connected-account panel alone                                                             | `connect-wallet`, `account`                                                                                                                                                                           |
| Sign a message or typed data, SIWE                                                                         | `sign-message`                                                                                                                                                                                        |
| Switch chain, require a chain                                                                              | `chain-selector`, `network-guard`                                                                                                                                                                     |
| Chain chip, live block, gas                                                                                | `chain-badge`, `block-number`, `gas-price`                                                                                                                                                            |
| Show an address or ENS name                                                                                | `address`, `address-avatar`, `ens-profile`, `explorer-link`                                                                                                                                           |
| Enter an address or ENS name                                                                               | `address-input`                                                                                                                                                                                       |
| Show a balance or amount                                                                                   | `balance`, `token-amount`, `token-icon`                                                                                                                                                               |
| Enter an amount, pick a token                                                                              | `token-input` (amount, picker, fiat, Max), `amount-input`, `token-select`                                                                                                                             |
| Add a token to the wallet, show an NFT                                                                     | `add-token`, `nft-card`                                                                                                                                                                               |
| Send a transaction or contract call                                                                        | `transaction-button`                                                                                                                                                                                  |
| ERC-20 approval before an action                                                                           | `approve-button`                                                                                                                                                                                      |
| Several calls in one prompt (EIP-5792)                                                                     | `batch-transaction`                                                                                                                                                                                   |
| Follow a transaction                                                                                       | `transaction-status` (inline), `transaction-toast` (mount `Toaster` from `@/components/primitives/toast` once)                                                                                        |
| Past transactions, contract events                                                                         | `transaction-history`, `event-feed`                                                                                                                                                                   |
| Forms for any contract from its ABI                                                                        | `contract-form`                                                                                                                                                                                       |
| Concentrated liquidity (Uniswap v3/v4 style): set a price range, pool depth, positions, fee tier, slippage | `price-range`, `position-card`, `liquidity-chart`, `depth-chart`, `range-indicator`, `fee-tier-select`, `slippage-input` (math in `concentrated-liquidity`, v3 transactions in `v3-position-manager`) |
| Whole features                                                                                             | blocks: `swap`, `send`, `portfolio`, `add-liquidity`, `remove-liquidity`                                                                                                                              |
| Building blocks                                                                                            | `copy-button`, `responsive-dialog`, `morph-text`                                                                                                                                                      |
| Let AI agents use the app and read the wallet (ui-sdk bridge, WebMCP)                                      | `agent-tools`                                                                                                                                                                                         |

Install several at once: `npx shadcn@latest add @0xui/wallet-button @0xui/balance --overwrite`. Dependencies between items install with them.

## Write code the way 0xui does

- **Amounts are `bigint`** end to end. Convert with viem `parseUnits` and `formatUnits`; amount inputs keep a string and use `inputMode="decimal"`.
- **Style and test by state**: async components set `data-phase` on their root, like `[data-phase="pending"]`. Each page's States table lists the phases.
- **A dismissed wallet prompt is a cancellation**: show a muted note, not an error. `data-error` names why an action failed (`user-rejected`, `reverted`, `insufficient-funds`, `wrong-chain`, …); `errorCode(phase, error)` from `0xui-utils` gives the same for your own components.
- **Agents: reading and filling are free, the wallet needs a person.** For an app AI agents should use, render `<AgentTools />` once inside `Web3Provider`. It creates ui-sdk's agent bridge, registers its `snapshot`, `act` and `query` tools plus the wallet tools with WebMCP, and shows a dialog ("Don't allow" / "Allow") before any agent step on a `data-agent-confirm` control. Don't call `createAgent` or `registerTools` next to it. For your own model loop, use `getAgent()`, `pageAgentTools` and `walletAgentTools(config, { confirm: askPerson })` from the same file.
- **Mark your own controls like 0xui does**: `data-agent-confirm="<sentence for the person>"` on anything that sends, signs, approves, connects or switches networks ("Deposits 100 USDC into the vault"), `data-agent-hidden` on keys and recovery phrases, `data-agent-secret` on fields an agent may fill but not read. Build controls from the primitives (Button, Field + Input) so agents can see them.
- **Explorer links** come from `chain.blockExplorers`, through `explorer-link` or `useExplorerLink`.
- Imports use the app's shadcn alias, like `import { Balance } from "@/components/balance"`.
- **Primitives** (button, popover, dialog, alert-dialog, tabs, avatar, field, toast) come from `@/components/primitives/*`, built on ui-sdk. 0xui components don't use shadcn's `@/components/ui/*`.
