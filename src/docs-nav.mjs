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
    label: "Shielded",
    icon: "shield",
    blurb: "Private accounts, balances, scans and proofs. A preview that runs on a mock engine.",
    items: [
      "shielded-engine",
      "mock-shielded-engine",
      "shielded-account",
      "shielded-balance",
      "shielded-sync-status",
      "shielded-transaction-status",
      "proof-progress",
      "shielded-address",
      "privacy-badge",
    ],
  },
  {
    label: "Utilities",
    icon: "wrench",
    blurb: "Small pieces the other components are built from.",
    items: ["copy-button", "responsive-dialog", "morph-text"],
  },
];

/**
 * The groups, plus a "More" group for any page nobody sorted into one, so a
 * new component never goes missing from the sidebar or the overview.
 *
 * @param {string[]} names Every component page name (file name without `.mdx`).
 * @returns {ComponentGroup[]}
 */
export function groupComponents(names) {
  const listed = new Set(groups.flatMap((group) => group.items));
  const unsorted = names.filter((name) => !listed.has(name)).sort();
  return unsorted.length
    ? [...groups, { label: "More", blurb: "", icon: "ellipsis", items: unsorted }]
    : groups;
}

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
