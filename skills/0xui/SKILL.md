---
name: 0xui
description: Builds web3 React UI from 0xui, a shadcn registry on wagmi, viem and Base UI. Use when adding wallet connect, balances, token or amount inputs, transactions, approvals, swaps, sends or ENS display to a React app, or when components.json lists the @0xui registry.
---

# Build with 0xui

0xui components are copied into the app as source with the shadcn CLI. Each one handles the states real wallets produce (pending, cancelled in wallet, wrong network, error) and exports its hook.

## Read the page first

Every docs page has a Markdown version: append `.md` to its URL, like https://0xui.dev/components/balance.md. Before you use a component, read its page: it has the install command, usage, props and the `data-phase` states. https://0xui.dev/llms.txt lists every page.

When the browser you're driving exposes WebMCP tools on 0xui.dev (`search_docs`, `get_doc`, `get_registry_item`), use those instead of fetching pages.

## Set up once

1. The project needs shadcn with the Base UI flavor: `npx shadcn@latest init --base base`. The Radix flavor isn't supported.
2. Add the registry to `components.json`:

   ```json
   { "registries": { "@0xui": "https://0xui.dev/r/{name}.json" } }
   ```

3. If the app has no `WagmiProvider`, run `npx shadcn@latest add @0xui/wagmi-config` and wrap the app in the `Web3Provider` it adds. Edit `lib/wagmi-config.ts` for the app's chains.

Setup is done when `npx shadcn@latest add @0xui/<name>` writes files into the project.

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
| Whole features | blocks: `swap`, `send`, `portfolio`, `shield` |
| Private (shielded) balances, preview on a mock engine | `shielded-engine`, `mock-shielded-engine`, `shielded-account`, `shielded-balance`, `shielded-sync-status`, `shielded-transaction-status`, `proof-progress`, `shielded-address`, `privacy-badge` |
| Building blocks | `copy-button`, `responsive-dialog`, `morph-text` |

Install several at once: `npx shadcn@latest add @0xui/wallet-button @0xui/balance`. Dependencies between items install with them.

## Write code the way 0xui does

- **Amounts are `bigint`** end to end. Convert with viem `parseUnits` and `formatUnits`; amount inputs keep a string and use `inputMode="decimal"`.
- **Style and test by state**: async components set `data-phase` on their root, like `[data-phase="pending"]`. Each page's States table lists the phases.
- **A dismissed wallet prompt is a cancellation**: show a muted note, not an error.
- **Explorer links** come from `chain.blockExplorers`, through `explorer-link` or `useExplorerLink`.
- Imports use the app's shadcn alias, like `import { Balance } from "@/components/balance"`.
