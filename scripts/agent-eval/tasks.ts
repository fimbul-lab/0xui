export type Task = {
  id: string;
  prompt: string;
  /** Passes when every item in at least one group is installed and imported by app code. */
  expect: Array<Array<string>>;
  /** Regexes that must not match app code (files the registry didn't write). */
  forbid?: Array<{ pattern: string; why: string }>;
};

/** Checked on every task: the app must wrap itself in a wagmi provider. */
export const requireAll = [
  {
    pattern: String.raw`\b(Web3Provider|WagmiProvider)\b`,
    why: "app is wrapped in a wagmi provider",
  },
];

export const tasks: Array<Task> = [
  {
    id: "header-balance",
    prompt:
      "Add a header to this app with a connect wallet button and the connected account's ETH balance.",
    expect: [["wallet-button", "balance"]],
    forbid: [
      { pattern: String.raw`\buseBalance\s*\(`, why: "hand-rolled balance instead of balance" },
      {
        pattern: String.raw`\buse(Connect|Connectors|Disconnect)\s*\(`,
        why: "hand-rolled connect instead of wallet-button",
      },
    ],
  },
  {
    id: "send-usdc",
    prompt: "Build a page where I can send USDC on Ethereum mainnet to an address or ENS name.",
    expect: [["send"], ["address-input", "token-input", "transaction-button"]],
    forbid: [
      {
        pattern: String.raw`\buse(SendTransaction|WriteContract)\s*\(`,
        why: "hand-rolled transaction instead of transaction-button",
      },
      {
        pattern: String.raw`\buseEnsAddress\s*\(`,
        why: "hand-rolled ENS lookup instead of address-input",
      },
    ],
  },
  {
    id: "approve-swap",
    prompt:
      "Add a button that approves USDC for our router at 0x1111111111111111111111111111111111111111 and then calls swap on it. The router's function is swap(address tokenIn, uint256 amountIn). Ethereum mainnet.",
    expect: [["approve-button", "transaction-button"]],
    forbid: [
      {
        pattern: String.raw`\buse(SendTransaction|WriteContract|WaitForTransactionReceipt)\s*\(`,
        why: "hand-rolled transaction instead of transaction-button",
      },
      {
        pattern: String.raw`functionName:\s*["']allowance["']`,
        why: "hand-rolled allowance check instead of approve-button",
      },
    ],
  },
];
