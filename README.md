# 0xui

Web3 React components you copy into your app. Built on [wagmi](https://wagmi.sh), [viem](https://viem.sh), [Base UI](https://base-ui.com) and Tailwind CSS v4, and installed with the [shadcn CLI](https://ui.shadcn.com/docs/cli).

Every component handles the states real wallets produce: pending, cancelled in wallet, wrong network, error. Each one exports its hook, so you can keep the logic and bring your own UI.

## Install

Add the registry to `components.json`:

```json
{
  "registries": {
    "@0xui": "https://0xui.dev/r/{name}.json"
  }
}
```

Set up wagmi (skip this if you already have a `WagmiProvider`), then add components:

```bash
npx shadcn@latest add @0xui/wagmi-config
npx shadcn@latest add @0xui/chain-selector
```

## Components

| Component | Description |
| --- | --- |
| `wallet-button` | Connect button when disconnected, account when connected. Start here. |
| `connect-wallet` | Wallet picker with recent/installed wallets and cancel handling. |
| `account` | Connected-account button and panel: balance, copy, explorer, disconnect. |
| `balance` | Native or ERC-20 balance. |
| `transaction-button` | Sends a transaction and shows every step: connect, switch, confirm, pending, done. |
| `transaction-status` | Inline card that follows a transaction from submitted to confirmed. |
| `token-input` | Swap panel: amount, token picker, fiat, balance with Max, insufficient state. |
| `token-select` | Searchable token picker with recent/popular tokens and balances. |
| `amount-input` | Decimal amount input with string state and decimal clamping. |
| `address-input` | Address or ENS input with resolution and checksum validation. Optionally accepts private `0zk` addresses. |
| `approve-button` | ERC-20 approval gate in front of your action. |
| `network-guard` | "Switch to X" notice for chain-specific content. |
| `sign-message` | Sign messages or typed data, with optional verification. |
| `transaction-toast` | Follow a transaction in a Sonner toast. |
| `add-token` | "Add USDC to wallet". |
| `swap` | Swap block with bring-your-own quotes, approval step, rate and price impact. |
| `send` | Send block for ETH and ERC-20s with ENS recipients. |
| `portfolio` | Token holdings with total value. |
| `batch-transaction` | Several calls in one wallet prompt (EIP-5792), step by step otherwise. |
| `contract-form` | Read/write forms for any contract from its ABI. |
| `transaction-history` | Transactions sent from your app with live status. |
| `ens-profile` | ENS profile card: avatar, bio, links. |
| `nft-card` | ERC-721/1155 card from on-chain metadata. |
| `event-feed` | Live feed of a contract's events. |
| `chain-selector` | Network switcher as a popover or dialog. |
| `chain-badge` | Static chain chip. Also exports `ChainIcon`. |
| `address` | ENS name or truncated address, with copy and explorer link. |
| `address-avatar` | ENS avatar or a gradient derived from the address. |
| `copy-button` | Copy to clipboard with confirmation. |
| `explorer-link` | Link to an address, tx or block on the chain's explorer. |
| `token-icon` | Token logo with fallbacks and an optional chain badge. |
| `token-amount` | `bigint` amount formatting, with optional fiat value. |
| `block-number` | Live block number and RPC health. |
| `gas-price` | Current gas in gwei, with optional low/medium/high tone. |

Shared helpers: `0xui-utils` (address and amount formatting, explorer links), `use-mounted`, `use-copy`.

### Shielded (preview)

Components for private balances. They talk to a shielded engine, and only a mock engine exists so far.

| Item | Description |
| --- | --- |
| `shielded-engine` | The interface between the components and a privacy protocol, with its provider and hooks. |
| `mock-shielded-engine` | In-memory engine for demos and tests. No network, no funds. |
| `shield` | Shield block: fee, wait and wallet prompts up front, then sign, approve and shield one click at a time (approve and shield in one prompt on batching wallets), and the funds followed until spendable. Two variants. |
| `shielded-account` | Create, import, unlock and lock the private account, with a recovery phrase step. |
| `shielded-transaction-status` | Follows a shield from the public chain into the private balance. |
| `shielded-balance` | Private balance of a token, split into spendable, pending, proving, incomplete and restricted. |
| `shielded-sync-status` | Scan progress with a bar that never moves backwards, and a retry. |
| `proof-progress` | Proof generation as stages, with cancel and retry. |
| `shielded-address` | Truncated private address with copy. |
| `privacy-badge` | Marks a value or action as public or private. |

See [PLAN.md](./PLAN.md) for the roadmap.

## Development

```bash
bun install
bun run dev     # docs site with live demos
bun run test    # Vitest, using wagmi's mock connector
bun run check   # typecheck
bun run lint
```

| Path | What lives there |
| --- | --- |
| `registry/default/` | The product. Laid out the way files land in a user's app (`components/`, `hooks/`, `lib/`). |
| `registry.json` | Registry manifest. `bun run registry:build` writes `public/r/*.json`. |
| `src/content/docs/` | Docs pages (Astro Starlight). |
| `src/demos/` | Live demos. Each export is one Astro island wrapped in a demo wallet. |
| `scripts/smoke-install.sh` | Installs every item into a fresh shadcn app and builds it. Runs in CI. |

In this repo, `@/…` imports resolve to `registry/default/` first and then `src/`, so registry code uses the same import paths it will have after install.
