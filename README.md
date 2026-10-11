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
| `chain-selector` | Network switcher as a popover or dialog. |

Shared helpers: `0xui-utils` (address and amount formatting, explorer links), `use-mounted`, `use-copy`.

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
