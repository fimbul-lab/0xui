---
name: 0xui
description: Builds web3 React UI from 0xui, a shadcn registry on wagmi, viem and Base UI. Use when adding wallet connect, balances, token or amount inputs, transactions, approvals, swaps, sends, liquidity positions or ENS display to a React app, or when components.json lists the @0xui registry.
---

# Build with 0xui

0xui components are copied into the app as source with the shadcn CLI. Each one handles the states real wallets produce (pending, cancelled in wallet, wrong network, error) and exports its hook.

## Read the page first

Every docs page has a Markdown version: append `.md` to its URL, like https://0xui.io/components/balance.md. Before you use a component, read its page: it has the install command, usage, props and the `data-phase` states. https://0xui.io/llms.txt lists every page. Each component also has a runnable example, `npx shadcn@latest add @0xui/<name>-demo`, and its props as JSON at https://0xui.io/props/<name>.json.

When the browser you're driving exposes WebMCP tools on 0xui.io (`search_docs`, `get_doc`, `get_registry_item`), use those instead of fetching pages.

## Set up once

1. The project needs shadcn with the Base UI flavor: `npx shadcn@latest init --base base`. The Radix flavor isn't supported.
2. Add the registry to `components.json`:

   ```json
   { "registries": { "@0xui": "https://0xui.io/r/{name}.json" } }
   ```

3. If the app has no `WagmiProvider`, run `npx shadcn@latest add @0xui/wagmi-config` and wrap the app in the `Web3Provider` it adds. Edit `lib/wagmi-config.ts` for the app's chains.

Run every `add` with `--overwrite`. Without a terminal the CLI can stop at an "overwrite?" question about a shadcn `ui/` file, exit 0 and leave the install half done. `--overwrite` replaces local edits to the files it installs, so when the project has customized 0xui files, read `--dry-run` first.

An install is done when the item's own file exists, like `components/wallet-button.tsx` for `@0xui/wallet-button`.

## Pick a component

Prefer a block or component over hand-rolled wagmi calls: they already handle cancellation, wrong network and loading. When the design needs a different UI, import the component's hook and keep its logic.

| Need | Item |
| --- | --- |
| Connect button for a header | `wallet-button` (wraps `connect-wallet` and `account`) |
| Wallet picker or connected-account panel alone | `connect-wallet`, `account` |
| Sign a message or typed data, SIWE | `sign-message` |
| Switch chain, require a chain | `chain-selector`, `network-guard` |
| Chain chip, live block, gas | `chain-badge`, `block-number`, `gas-price` |
| Show an address or ENS name | `address`, `address-avatar`, `ens-profile`, `explorer-link` |
| Enter an address or ENS name | `address-input` |
| Show a balance or amount | `balance`, `token-amount`, `token-icon` |
| Enter an amount, pick a token | `token-input` (amount, picker, fiat, Max), `amount-input`, `token-select` |
| Add a token to the wallet, show an NFT | `add-token`, `nft-card` |
| Send a transaction or contract call | `transaction-button` |
| ERC-20 approval before an action | `approve-button` |
| Several calls in one prompt (EIP-5792) | `batch-transaction` |
| Follow a transaction | `transaction-status` (inline), `transaction-toast` (Sonner) |
| Past transactions, contract events | `transaction-history`, `event-feed` |
| Forms for any contract from its ABI | `contract-form` |
| Concentrated liquidity (Uniswap v3/v4 style): set a price range, pool depth, position status, fee tier | `price-range`, `liquidity-chart`, `depth-chart`, `range-indicator`, `fee-tier-select` (math in `concentrated-liquidity`) |
| Whole features | blocks: `swap`, `send`, `portfolio`, `add-liquidity` |
| Building blocks | `copy-button`, `responsive-dialog`, `morph-text` |
| Let browser agents read the wallet (WebMCP) | `agent-tools` |

Install several at once: `npx shadcn@latest add @0xui/wallet-button @0xui/balance --overwrite`. Dependencies between items install with them.

## Write code the way 0xui does

- **Amounts are `bigint`** end to end. Convert with viem `parseUnits` and `formatUnits`; amount inputs keep a string and use `inputMode="decimal"`.
- **Style and test by state**: async components set `data-phase` on their root, like `[data-phase="pending"]`. Each page's States table lists the phases.
- **A dismissed wallet prompt is a cancellation**: show a muted note, not an error. `data-error` names why an action failed (`user-rejected`, `reverted`, `insufficient-funds`, `wrong-chain`, …); `errorCode(phase, error)` from `0xui-utils` gives the same for your own components.
- **Buttons that send, sign or approve need a person**: 0xui sets `data-agent-confirm` on them. Give your own such buttons the attribute too, with a sentence saying what they do.
- **Explorer links** come from `chain.blockExplorers`, through `explorer-link` or `useExplorerLink`.
- Imports use the app's shadcn alias, like `import { Balance } from "@/components/balance"`.
