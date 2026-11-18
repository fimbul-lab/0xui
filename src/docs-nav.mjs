// Component categories, shared by the sidebar (astro.config.mjs) and the
// components overview page. Order inside a group is by how often you reach for
// the component, not alphabetical.
//
// No Node APIs here: this file is also bundled into the pages.

/** @typedef {{ label: string; blurb: string; items: string[] }} ComponentGroup */

/** @type {ComponentGroup[]} */
const groups = [
  {
    label: "Wallet",
    blurb: "Connect, show the account, sign.",
    items: ["wallet-button", "connect-wallet", "account", "sign-message"],
  },
  {
    label: "Network",
    blurb: "Pick a chain, guard against the wrong one, show its pulse.",
    items: ["chain-selector", "network-guard", "chain-badge", "block-number", "gas-price"],
  },
  {
    label: "Identity",
    blurb: "Addresses, ENS names and avatars.",
    items: ["address", "address-input", "address-avatar", "ens-profile", "explorer-link"],
  },
  {
    label: "Tokens",
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
  return unsorted.length ? [...groups, { label: "More", blurb: "", items: unsorted }] : groups;
}
