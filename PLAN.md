# 0xui — Strategic Plan

Web3 UI component registry (shadcn-style, copy-paste via CLI) built on wagmi + viem + Radix + Tailwind v4, documented with Astro Starlight. Goal: the best DX and the most agent-friendly web3 component library.

---

## 1. Repo fixes (do first — the package is currently broken)

| # | Problem | Fix |
|---|---------|-----|
| 1 | `package.json` `name` is `""` | Set to `0xui` (or `0xui-docs`). Decide one brand: `registry.json` says `web3-cn`, repo says `0xui`. Pick `0xui` everywhere. |
| 2 | `@tanstack/react-query` imported in `src/lib/config/wagmi-provider.tsx` but not in `dependencies` | Add it. Currently only works via transitive resolution — will break on clean install. |
| 3 | Two lockfiles: `bun.lock` + `package-lock.json` | Delete `package-lock.json`, keep bun. |
| 4 | `package-2.json` — leftover from old TanStack Start/fumadocs app | Delete. |
| 5 | `registry.json` file paths point to deleted `registry/default/...`; actual files live in `src/components/registry/default/...`; empty `registry/` dir at root | Move registry source back to root `registry/default/...` (shadcn convention) and import them into docs from there, OR update `registry.json` paths. Root `registry/` recommended — cleaner separation of "product" (registry) vs "docs site" (src). |
| 6 | `registry.json` still lists `swap-input` nowhere but ships `wagmi-config` with `@tanstack/react-query` dep — fine — but `homepage` points to `webfluential/web3-cn` | Update homepage + name. |
| 7 | `astro.config.mjs` is starter boilerplate: title "Docs with Tailwind", GitHub link to withastro/starlight | Set 0xui title, own repo link, sidebar sections: Getting Started / Components. |
| 8 | `README.md` is the Starlight starter README | Rewrite: what 0xui is, install command (`npx shadcn@latest add https://0xui.dev/r/chain-selector.json`), component list. |
| 9 | No `lint`/`format` scripts although `oxlint`/`oxfmt` are devDeps; `.oxfmtrc.json` was deleted | Re-add scripts + config. |
| 10 | No CI, no `registry:build` output committed (`public/r/*.json` deleted) | Add `registry:build` to the build pipeline so `/r/*.json` is always generated at build time (don't commit generated output). |

## 2. Current component audit

### chain-selector (`ChainSelector` + `ChainSelectorDialog`)
Solid feature set (icon variants, iconOnly, mainnet/testnet tabs, custom icon injection). Problems:

- **Bug:** `iconSize` prop is destructured but not declared in `ChainSelectorProps` → TS error.
- **Bug:** `` cn(`size-${iconSize}`) `` — dynamic Tailwind class; the compiler can't see it, so it generates nothing. Use a fixed class or `--size` CSS var / style prop.
- **~90% duplication** between `ChainSelector` and `ChainSelectorDialog`. Extract shared pieces: `ChainSelectorTrigger`, `ChainList` (the tabs+grid part already exists as `ChainsGrid`). Then popover/dialog variants become thin shells — or a single component with `presentation="popover" | "dialog"` prop.
- Dead code: pointless `try/catch` around `onSwitch?.()` in `ChainItem`, unnecessary `key` on the button.
- **UX gaps (from research below):** no active-chain checkmark/highlight in the list, no per-item pending state (which chain is switching), no error surface when the wallet rejects the switch (only `console.error`), popover header "Select Network" is a plain div (should be styled label), no keyboard/focus treatment on grid items beyond native button.
- Prop-type union (`mono` vs others) is clever but duplicated 4×. Extract `IconVariantProps` union once, intersect it in.

### swap-input
A stub (two bare `<Input>`s). Don't ship it; rebuild as `token-input` + composed `swap` block (see roadmap). Remove from registry until real.

### wagmi-config (registry:file)
Fine as a starter. Improve: include `injected()`/`walletConnect()` connectors commented, `ssr: true` note for Next users, and register it as `registry:lib` dependency of every component so `shadcn add` installs a working setup in one command.

### ui/* (button, dialog, popover, tabs, avatar, input, card, scroll-area, collapsible)
Standard shadcn — keep as registryDependencies, don't fork them further than needed.

---

## 3. Design research — dos and don'ts

Sources: Mobbin screens (Coinbase, Uniswap, OpenSea, Kraken, OKX, Binance, Family, Portrait/Privy, Acctual/Dynamic) + Laws of UX.

### Wallet connect modal
Refs: [Coinbase](https://mobbin.com/screens/0028e86d-943f-4bfd-8be6-ce4f873921ce), [OpenSea](https://mobbin.com/screens/133d82b5-f892-4ee4-8bf1-a177f1637e0a), [Portrait/Privy](https://mobbin.com/screens/fe79e77e-0975-48c1-9bf5-8b7ba904e9c4), [Tally](https://mobbin.com/screens/a8e8430c-60ec-4b63-a25c-b2238282c9d1)

- **Do** show 3–5 wallets max + "Other wallets" escape hatch (Hick's Law / Choice Overload — every reference app does exactly this).
- **Do** badge context: "Installed" (OpenSea), "Recent" (Portrait) — recognition over recall, and it front-loads the likeliest choice (Serial Position Effect).
- **Do** full-row click targets ≥44px with icon left, name, chevron right (Fitts's, Jakob's).
- **Do** reassurance microcopy at bottom ("no personally identifiable information…", terms links) — Coinbase pattern.
- **Don't** dump 300 wallets in the first view; **don't** block on detection — render list optimistically.

### Chain / network selector
Refs: [Coinbase](https://mobbin.com/screens/b75eaa02-193b-465b-9c3b-3309400c0517), [Kraken](https://mobbin.com/screens/89a8a821-01c0-418b-99f2-cac9dba3172f), [OKX](https://mobbin.com/screens/a7186170-72c0-4a15-97f0-e9d67b8f3dcf), [Uniswap](https://mobbin.com/screens/48aa4ff2-e19f-4a17-8bcb-d599a0fe9416)

- **Do** icon + name + optional metadata slot per row (Coinbase shows "~21 sec", Kraken shows min deposit) — support a `renderMeta`/`meta` slot per chain.
- **Do** mark the active chain ("Default" badge / checkmark) — current component doesn't.
- **Do** offer an "All networks" option pattern for filter contexts (Uniswap).
- **Do** keep mainnet/testnet grouping (already built — matches Chunking/Miller).
- **Don't** hard-fail silently on rejected switch; show inline error state (Doherty: feedback, always).

### Token select
Refs: [Uniswap](https://mobbin.com/screens/864dda50-5223-47c7-ad05-80bc1ddb77fd), [Kraken](https://mobbin.com/screens/f7185c26-962a-435b-9bf6-f45c1c53f54b), [OKX](https://mobbin.com/screens/41a77cf4-8420-47ea-97b7-e35c057a5323)

- **Do** search input first, then "Recent searches", then "Popular tokens", then full list (Uniswap) — Serial Position + recognition.
- **Do** universal row anatomy: icon | name + symbol (+truncated address) left, balance + fiat value right — Law of Common Region; every app converges here (Jakob's Law).
- **Do** filter chips when lists are long (OKX: All / Stablecoins / Fiat).
- **Don't** show raw contract addresses as primary text; truncate `0x1234…abcd` with copy affordance.

### Amount / swap input
Refs: [Uniswap](https://mobbin.com/screens/5d758688-a945-4ad8-93b2-9a6cf0584bbd), [OpenSea swap](https://mobbin.com/screens/6a69de36-4f28-4841-8294-f7a195fa87a1), [OKX](https://mobbin.com/screens/98a75466-4571-4277-aaea-520b22c83115)

- **Do** big borderless numeric input, token pill on the right, fiat sub-label under amount, balance + Max, flip button between panels (Jakob's — Uniswap defined this mental model).
- **Do** disabled CTA that names the blocker: "Enter an amount" → "Insufficient balance" → "Swap" (Tesler: system carries the complexity; also perfect agent-readable state).
- **Do** accept flexible input: leading ".", commas, paste with symbols (Postel's Law); clamp decimals to token decimals.
- **Don't** use `type="number"`; use inputmode decimal + string state (float precision kills token amounts).

### Transaction status
Refs: [Family](https://mobbin.com/screens/a6e508d5-d599-42c7-9c01-2dc0213840bb), [Acctual](https://mobbin.com/screens/84637b5d-c5bd-4c74-80aa-c0823c620de6), [OpenSea success toast](https://mobbin.com/screens/720b7665-8f4d-4ed9-b0e0-0f1999bda505)

- **Do** model explicit phases: idle → awaiting wallet confirmation → pending (hash exists) → confirmed / failed (Zeigarnik + Goal-Gradient: visible progress).
- **Do** show tx summary (chain, amount, to) alongside the spinner (Family) and explorer link once hash exists.
- **Do** celebrate success distinctly (Peak-End Rule) — success toast/state is the last thing users remember.
- **Don't** leave a spinner with no words; label each phase ("Awaiting wallet confirmation…" — Acctual).

### Account / connected state
Refs: [Uniswap panel](https://mobbin.com/screens/d7181ace-9ffd-417d-8e6f-4fb68bdee155), [OpenSea panel](https://mobbin.com/screens/720b7665-8f4d-4ed9-b0e0-0f1999bda505), [Family](https://mobbin.com/screens/0d16504e-cac4-4855-8290-415f3c1f110e)

- **Do** trigger = avatar/identicon + truncated address (ENS name when available); panel = balance headline, copy address, explorer link, disconnect.
- **Do** one visually distinct primary action per surface (Von Restorff).

---

## 4. Component roadmap

Ship order optimizes for: every dapp needs it → differentiating → composed showcases.

### Phase A — Foundation (every dapp, day one)
1. **connect-wallet** — button + modal. Connectors from wagmi `useConnect`, installed/recent badges, "Other wallets" overflow, error state. The single most-used web3 component; flagship quality bar.
2. **account** — connected trigger + dropdown/panel: identicon, ENS, truncated address, copy, balance, explorer link, disconnect. Pairs with connect-wallet as one `<WalletButton>` that swaps state.
3. **chain-selector** — refactor existing (dedupe popover/dialog, fix bugs, add active indicator, per-item pending, error state).
4. **address** — display primitive: truncate, ENS resolve, copy, explorer link. Tiny but used everywhere; great agent building block.
5. **wagmi-config** — registry:lib, dependency of all of the above.

### Phase B — Inputs
6. **token-select** — searchable dialog/drawer: recent, popular, balances, custom token list prop.
7. **amount-input** — string-state decimal input, max button, fiat estimate slot, decimals clamping, Postel-tolerant parsing.
8. **token-input** — amount-input + token-select composed (the Uniswap panel).
9. **address-input** — paste, ENS resolution with loading state, checksum validation, inline error.

### Phase C — Transactions
10. **transaction-button** — wraps `useWriteContract`/`useSendTransaction`; renders phase-labeled states; auto chain-switch prompt if wrong network (Tesler).
11. **transaction-status** — inline status + toast variant; phases, hash, explorer link, confirmations count.
12. **transaction-history** — simple list keyed off local store of hashes.

### Phase D — Composed blocks (showcases, docs heroes)
13. **swap** — two token-inputs + flip + rate row + transaction-button. Replaces the swap-input stub.
14. **send** — address-input + token-input + transaction flow.
15. **balance / portfolio-list** — token rows with fiat values.

Cross-cutting for every component: light/dark via CSS vars only, 44px min targets, keyboard nav, `aria` labels (iconOnly already does this — keep the bar), SSR-safe (`mounted` guard pattern already used — extract to a `useMounted` hook in lib).

## 5. DX + agent-friendliness (the moat)

- **One command install:** every registry item declares full `dependencies` + `registryDependencies` + `wagmi-config` as lib dep → `shadcn add <url>` yields a compiling app.
- **Registry MCP:** shadcn CLI v3 supports registry MCP (`npx shadcn registry:mcp`) — document it so agents can browse/install 0xui directly. This alone differentiates from every other web3 lib.
- **llms.txt + llms-full.txt** on the docs site (Starlight has community plugins) — full component source + props inline so agents can copy without crawling.
- **Rich `description` fields in registry.json** — agents choose components by these; write them like search snippets (what it does, states it handles, hooks it uses).
- **Predictable prop API contract** across all components: `variant`, `size`, icon-slot props accept `ComponentType | false`, callbacks `onX`, controlled+uncontrolled (`open`/`defaultOpen`/`onOpenChange`). Document the contract once.
- **State machines named in code** — export the phase union types (`type TxPhase = "idle" | "confirming" | "pending" | ...`) so agents (and humans) branch on them.
- **JSDoc every prop** (chain-selector already does — keep it mandatory).
- **Each doc page:** live demo, install command, props table, "when to use", and a copyable minimal example — agents scrape docs; humans skim them (Paradox of the Active User: examples over prose).

## 6. Suggested execution order

1. Repo fixes (§1) — ~1 session, unblocks everything.
2. chain-selector refactor (§2) — establishes the shared primitives (`useMounted`, icon-slot pattern, list rows).
3. connect-wallet + account — flagship pair.
4. Docs polish + llms.txt + registry MCP docs.
5. Phase B → C → D, one component per PR, doc page ships with component.
