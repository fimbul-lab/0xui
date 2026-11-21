// Component categories, shared by the sidebar (astro.config.mjs) and the
// components overview page. Order inside a group is by how often you reach for
// the component, not alphabetical.
//
// No Node APIs here: this file is also bundled into the pages.

/**
 * `icon` is a lucide icon name, rendered by src/components/docs/GroupIcon.astro.
 *
 * @typedef {{ label: string; blurb: string; icon: string; items: string[] }} ComponentGroup
 */

/** Getting started pages, in reading order. */
export const gettingStarted = [
  { label: "Installation", slug: "getting-started/installation" },
  { label: "Conventions", slug: "getting-started/conventions" },
  { label: "Hello dapp", slug: "getting-started/hello-dapp" },
  { label: "Token lists", slug: "getting-started/token-lists" },
  { label: "Indexed data", slug: "getting-started/indexed-data" },
  { label: "Sign in with Ethereum", slug: "getting-started/siwe" },
  { label: "AI agents", slug: "getting-started/agents" },
];

/** @type {ComponentGroup[]} */
const groups = [
  {
    label: "Wallet",
    icon: "wallet",
    blurb: "Connect, show the account, sign.",
    items: ["wallet-button", "connect-wallet", "account", "sign-message"],
  },
  {
    label: "Network",
    icon: "network",
    blurb: "Pick a chain, guard against the wrong one, show its pulse.",
    items: ["chain-selector", "network-guard", "chain-badge", "block-number", "gas-price"],
  },
  {
    label: "Identity",
    icon: "circle-user-round",
    blurb: "Addresses, ENS names and avatars.",
    items: ["address", "address-input", "address-avatar", "ens-profile", "explorer-link"],
  },
  {
    label: "Tokens",
    icon: "coins",
    blurb: "Balances, amounts and token pickers.",
    items: [
      "token-input",
      "token-select",
      "amount-input",
      "balance",
      "token-amount",
      "token-icon",
      "add-token",
      "nft-card",
    ],
  },
  {
    label: "Transactions",
    icon: "arrow-right-left",
    blurb: "Send, approve, track and read contracts.",
    items: [
      "transaction-button",
      "approve-button",
      "batch-transaction",
      "transaction-status",
      "transaction-toast",
      "transaction-history",
      "contract-form",
      "event-feed",
    ],
  },
  {
    label: "Utilities",
    icon: "wrench",
    blurb: "Small pieces the other components are built from, and tools for browser agents.",
    items: ["copy-button", "responsive-dialog", "morph-text", "agent-tools"],
  },
];

/**
 * The shielded preview: pages that build and open by URL, but are listed
 * nowhere else. Not in the sidebar, the overviews, search, llms.txt, WebMCP,
 * the agent skill or the registry index (scripts/unlist-registry.mjs), so
 * neither people nor agents install them by accident.
 * They run on the mock engine only, and `shielded-account` still needs its
 * security review. List them again once a real engine works (PLAN.md, phase 5).
 * The `/shielded/` page links them all.
 */
export const shieldedPreview = {
  blocks: ["shield", "unshield"],
  components: [
    "shielded-engine",
    "mock-shielded-engine",
    "privacy-pools-engine",
    "shielded-account",
    "shielded-balance",
    "shielded-sync-status",
    "shielded-transaction-status",
    "proof-progress",
    "shielded-address",
    "privacy-badge",
  ],
};

/** Ids of the unlisted pages, like `components/shielded-balance`. */
export const unlistedPages = new Set([
  "shielded",
  ...shieldedPreview.blocks.map((name) => `blocks/${name}`),
  ...shieldedPreview.components.map((name) => `components/${name}`),
]);

/**
 * Whether a registry item belongs to an unlisted page: the item itself, like
 * `shielded-balance`, or its example, `shielded-balance-demo`.
 *
 * @param {string} name Registry item name.
 */
export function isUnlistedItem(name) {
  const page = name.replace(/-demo$/, "");
  return unlistedPages.has(`blocks/${page}`) || unlistedPages.has(`components/${page}`);
}

/**
 * The groups, plus a "More" group for any page nobody sorted into one, so a
 * new component never goes missing from the sidebar or the overview. Unlisted
 * pages are left out.
 *
 * @param {string[]} names Every component page name (file name without `.mdx`).
 * @returns {ComponentGroup[]}
 */
export function groupComponents(names) {
  const listed = new Set(groups.flatMap((group) => group.items));
  const unsorted = names
    .filter((name) => !listed.has(name) && !unlistedPages.has(`components/${name}`))
    .sort();
  return unsorted.length
    ? [...groups, { label: "More", blurb: "", icon: "ellipsis", items: unsorted }]
    : groups;
}

/**
 * Label of the group a component is sorted into, like "Wallet". Undefined
 * for unlisted and unsorted components.
 *
 * @param {string} name Component page name, like `wallet-button`.
 */
export function groupOf(name) {
  return groups.find((group) => group.items.includes(name))?.label;
}

/** Every listed component, in sidebar order. */
export const listedComponents = groups.flatMap((group) => group.items);

/**
 * Icon for every top-level sidebar entry, by label: the sections and the
 * "Components" link in astro.config.mjs, and the component groups above.
 *
 * @type {Record<string, string>}
 */
export const groupIcons = {
  "Getting started": "book-open",
  Blocks: "layout-template",
  Components: "layout-grid",
  ...Object.fromEntries(groups.map((group) => [group.label, group.icon])),
  More: "ellipsis",
};
