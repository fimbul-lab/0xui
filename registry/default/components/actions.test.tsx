import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createAgent } from "@ui-sdk/react/agent";
import { useEffect } from "react";
import { decodeFunctionData, erc20Abi, parseUnits } from "viem";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  connectMock,
  createTestConfig,
  erc20CallRpc,
  fakeChainRpc,
  fakeTxHash,
  renderWithWagmi,
  testAccounts,
} from "../../../test/wagmi";
import { AddToken } from "./add-token";
import { ApproveButton } from "./approve-button";
import { NetworkGuard } from "./network-guard";
import { Toaster, toast } from "./primitives/toast";
import { SignMessage } from "./sign-message";
import { useTransactionToast } from "./transaction-toast";

const usdc = {
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
  symbol: "USDC",
  decimals: 6,
};
const router = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af" as Address;

// The shared toast queue opens its overlay once, on its first toast, and
// ui-sdk checks a second later that a host renders it. Open it here with a
// host mounted through that check; otherwise it lands between two tests,
// with no host, and fails the run.
beforeAll(async () => {
  vi.useFakeTimers();
  const { unmount } = render(<Toaster />);
  act(() => {
    toast("Warm-up");
    toast.dismiss();
  });
  await act(() => vi.advanceTimersByTimeAsync(1100));
  unmount();
  vi.useRealTimers();
});

// Each test's toasts go before its host does.
afterEach(async () => {
  act(() => toast.dismiss());
  await waitFor(() => expect(toast.toasts()).toHaveLength(0));
});

describe("ApproveButton", () => {
  it("approves, then shows the action", async () => {
    const user = userEvent.setup();
    let allowance = 0n;
    const chain = fakeChainRpc();
    const send = chain.eth_sendTransaction as (p: unknown) => unknown;
    const config = createTestConfig({
      rpc: {
        ...chain,
        eth_call: erc20CallRpc({ allowance: () => allowance, decimals: 6 }),
        eth_sendTransaction: (params: unknown) => {
          allowance = parseUnits("50", 6);
          return send(params);
        },
      },
    });
    renderWithWagmi(
      <ApproveButton token={usdc} spender={router} amount={parseUnits("50", 6)} chainId={1}>
        <button>Swap</button>
      </ApproveButton>,
      { config },
    );
    await act(() => connectMock(config));

    const approve = await screen.findByRole("button", { name: "Approve USDC" });
    expect(approve).toHaveAttribute(
      "data-agent-confirm",
      `Approve USDC: lets ${router} spend up to 50 USDC`,
    );
    await user.click(approve);

    expect(
      await screen.findByRole("button", { name: "Swap" }, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it("skips approval when the allowance already covers the amount", async () => {
    const config = createTestConfig({
      rpc: { eth_call: erc20CallRpc({ allowance: parseUnits("100", 6) }) },
    });
    renderWithWagmi(
      <ApproveButton token={usdc} spender={router} amount={parseUnits("50", 6)} chainId={1}>
        <button>Swap</button>
      </ApproveButton>,
      { config },
    );
    await act(() => connectMock(config));

    expect(await screen.findByRole("button", { name: "Swap" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve USDC" })).not.toBeInTheDocument();
  });

  it("resets a leftover USDT allowance to 0 before approving", async () => {
    const user = userEvent.setup();
    const usdt = {
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7" as Address,
      symbol: "USDT",
    };
    let allowance = parseUnits("5", 6);
    const approved: Array<bigint> = [];
    const chain = fakeChainRpc();
    const send = chain.eth_sendTransaction as (p: unknown) => unknown;
    const config = createTestConfig({
      rpc: {
        ...chain,
        eth_call: erc20CallRpc({ allowance: () => allowance, decimals: 6 }),
        eth_sendTransaction: (params: [{ data: Hex }]) => {
          const { args } = decodeFunctionData({ abi: erc20Abi, data: params[0].data });
          const amount = args[1];
          if (typeof amount !== "bigint") {
            throw new Error("Expected an approve call.");
          }
          allowance = amount;
          approved.push(allowance);
          return send(params);
        },
      },
    });
    renderWithWagmi(
      <ApproveButton token={usdt} spender={router} amount={parseUnits("50", 6)} chainId={1}>
        <button>Swap</button>
      </ApproveButton>,
      { config },
    );
    await act(() => connectMock(config));

    await user.click(await screen.findByRole("button", { name: "Reset USDT approval" }));
    await user.click(
      await screen.findByRole("button", { name: "Approve USDT" }, { timeout: 5000 }),
    );

    expect(
      await screen.findByRole("button", { name: "Swap" }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(approved).toEqual([0n, parseUnits("50", 6)]);
  });
});

describe("NetworkGuard", () => {
  it("renders children when no wallet is connected", () => {
    renderWithWagmi(<NetworkGuard chainId={11_155_111}>Content</NetworkGuard>);
    expect(screen.getByText("Content")).toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("asks to switch, then gets out of the way", async () => {
    const user = userEvent.setup();
    const config = createTestConfig();
    renderWithWagmi(
      <NetworkGuard chainId={11_155_111} mode="replace">
        Content
      </NetworkGuard>,
      { config },
    );
    await act(() => connectMock(config));

    const notice = await screen.findByRole("region", { name: "Wrong network" });
    expect(notice).toHaveTextContent("This works on Sepolia.");
    expect(screen.queryByText("Content")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Switch to Sepolia" }));
    expect(await screen.findByText("Content")).toBeInTheDocument();
  });

  it("treats a declined switch as cancelled", async () => {
    const user = userEvent.setup();
    const config = createTestConfig({ features: { switchChainError: true } });
    renderWithWagmi(<NetworkGuard chainId={11_155_111}>Content</NetworkGuard>, { config });
    await act(() => connectMock(config));

    await user.click(await screen.findByRole("button", { name: "Switch to Sepolia" }));
    expect(await screen.findByText("Switch cancelled in wallet.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Wrong network" })).toHaveAttribute(
      "data-error",
      "user-rejected",
    );
  });
});

describe("SignMessage", () => {
  // A real key so signatures verify against the connected address.
  const signer = privateKeyToAccount(generatePrivateKey());
  const signerConfig = (extra = {}) =>
    createTestConfig({
      accounts: [signer.address],
      rpc: {
        // The mock wallet forwards personal_sign as eth_sign([address, message]).
        eth_sign: ([, raw]: [Address, `0x${string}`]) => signer.signMessage({ message: { raw } }),
        ...extra,
      },
    });

  it("signs and verifies a message", async () => {
    const user = userEvent.setup();
    const onSigned = vi.fn();
    const config = signerConfig();
    renderWithWagmi(
      <SignMessage message="Sign in to 0xui" verify showMessage onSigned={onSigned} />,
      { config },
    );
    await act(() => connectMock(config));

    expect(screen.getByText("Sign in to 0xui")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign message" }));

    expect(await screen.findByRole("button", { name: "Signature verified" })).toBeInTheDocument();
    expect(onSigned).toHaveBeenCalledWith(expect.stringMatching(/^0x[0-9a-f]{130}$/));
  });

  it("flags a signature from someone else", async () => {
    const user = userEvent.setup();
    const other = privateKeyToAccount(generatePrivateKey());
    const config = signerConfig({
      eth_sign: ([, raw]: [Address, `0x${string}`]) => other.signMessage({ message: { raw } }),
    });
    renderWithWagmi(<SignMessage message="hello" verify />, { config });
    await act(() => connectMock(config));

    await user.click(screen.getByRole("button", { name: "Sign message" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("doesn't match");
  });

  it("treats a declined signature as cancelled", async () => {
    const user = userEvent.setup();
    const config = createTestConfig({ features: { signMessageError: true } });
    renderWithWagmi(<SignMessage message="hello" />, { config });
    await act(() => connectMock(config));

    const button = screen.getByRole("button", { name: "Sign message" });
    expect(button).toHaveAttribute(
      "data-agent-confirm",
      "Sign message: signs a message with your wallet",
    );
    await user.click(button);
    expect(await screen.findByText("Cancelled in wallet.")).toBeInTheDocument();
    expect(button.closest("[data-slot=sign-message]")).toHaveAttribute("data-phase", "cancelled");
    expect(button.closest("[data-slot=sign-message]")).toHaveAttribute(
      "data-error",
      "user-rejected",
    );
  });

  it("asks to connect first", async () => {
    const user = userEvent.setup();
    renderWithWagmi(<SignMessage message="hello" />);
    await user.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(await screen.findByRole("dialog", { name: "Connect a wallet" })).toBeInTheDocument();
  });
});

function ToastTrigger({ status }: { status: string }) {
  const toastTransaction = useTransactionToast();
  return (
    <>
      <Toaster />
      <button onClick={() => toastTransaction(fakeTxHash, { description: `Send (${status})` })}>
        Track
      </button>
    </>
  );
}

describe("useTransactionToast", () => {
  it.each([
    ["success", "Transaction confirmed"],
    ["reverted", "Transaction reverted"],
  ] as const)("follows a %s transaction", async (status, heading) => {
    const user = userEvent.setup();
    const chain = fakeChainRpc({ status });
    renderWithWagmi(<ToastTrigger status={status} />, {
      config: createTestConfig({ rpc: chain }),
    });

    await user.click(screen.getByRole("button", { name: "Track" }));
    expect(await screen.findByText("Transaction pending")).toBeInTheDocument();
    expect(screen.getByText(`Send (${status})`)).toBeInTheDocument();

    // Now the transaction lands on chain.
    (chain.eth_sendTransaction as (p: unknown) => unknown)([
      { from: testAccounts[0], to: testAccounts[1] },
    ]);
    const settled = await screen.findByText(heading, {}, { timeout: 5000 });
    // The shared toast queue is global, so earlier tests' toasts may still be showing.
    const toastEl = settled.closest("[data-slot=toast]");
    if (!(toastEl instanceof HTMLElement)) {
      throw new Error("The heading isn't in a toast.");
    }
    expect(within(toastEl).getByRole("link", { name: "View" })).toHaveAttribute(
      "href",
      `https://etherscan.io/tx/${fakeTxHash}`,
    );
  });
});

describe("AddToken", () => {
  it("renders nothing when disconnected", () => {
    const { container } = renderWithWagmi(<AddToken token={usdc} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("adds the token", async () => {
    const user = userEvent.setup();
    const config = createTestConfig();
    renderWithWagmi(<AddToken token={usdc} />, { config });
    await act(() => connectMock(config));

    await user.click(await screen.findByRole("button", { name: "Add USDC to wallet" }));
    expect(await screen.findByRole("button", { name: "USDC added" })).toBeDisabled();
  });

  it("treats a declined prompt as cancelled", async () => {
    const user = userEvent.setup();
    const config = createTestConfig({ features: { watchAssetError: true } });
    renderWithWagmi(<AddToken token={usdc} />, { config });
    await act(() => connectMock(config));

    await user.click(await screen.findByRole("button", { name: "Add USDC to wallet" }));
    expect(await screen.findByText("Cancelled in wallet.")).toBeInTheDocument();
  });
});

describe("agent", () => {
  let approve = false;
  const agent = createAgent({ allow: (step) => !step.confirm || approve });
  const onPage = () =>
    agent.snapshot().filter((entry) => !entry.offPage && entry.component !== "more");
  const named = (label: string) => onPage().find((entry) => entry.label === label);

  it("asks the person before NetworkGuard switches network", async () => {
    approve = false;
    const config = createTestConfig();
    renderWithWagmi(<NetworkGuard chainId={11_155_111}>Content</NetworkGuard>, { config });
    await act(() => connectMock(config));

    await screen.findByRole("button", { name: "Switch to Sepolia" });
    expect(named("Switch to Sepolia")?.confirm).toBe("Asks your wallet to switch to Sepolia");
    const step = { steps: [{ ref: "Switch to Sepolia", action: "press" }] };
    expect((await agent.act(step)).error?.message).toContain(
      "Asks your wallet to switch to Sepolia",
    );
    expect(config.state.chainId).toBe(1);
    approve = true;
    expect((await agent.act(step)).ok).toBe(true);
    await waitFor(() => expect(config.state.chainId).toBe(11_155_111));
  });

  it("asks the person before adding a token to the wallet", async () => {
    approve = false;
    const config = createTestConfig();
    renderWithWagmi(<AddToken token={usdc} />, { config });
    await act(() => connectMock(config));

    await screen.findByRole("button", { name: "Add USDC to wallet" });
    expect(named("Add USDC to wallet")?.confirm).toBe(
      "Asks your wallet to add USDC (0xA0b8…eB48) to its token list",
    );
    const step = { steps: [{ ref: "Add USDC", action: "press" }] };
    expect((await agent.act(step)).ok).toBe(false);
    expect(screen.queryByRole("button", { name: "USDC added" })).not.toBeInTheDocument();
    approve = true;
    expect((await agent.act(step)).ok).toBe(true);
    expect(await screen.findByRole("button", { name: "USDC added" })).toBeInTheDocument();
  });

  it("asks before signing, but not before opening the wallet picker", async () => {
    approve = false;
    const signer = privateKeyToAccount(generatePrivateKey());
    const config = createTestConfig({
      accounts: [signer.address],
      rpc: {
        eth_sign: ([, raw]: [Address, `0x${string}`]) => signer.signMessage({ message: { raw } }),
      },
    });
    renderWithWagmi(<SignMessage message="hello" showSignature />, { config });

    expect(named("Connect wallet")?.confirm).toBeUndefined();
    await act(() => connectMock(config));
    await screen.findByRole("button", { name: "Sign message" });
    expect(named("Sign message")?.confirm).toBe("Sign message: signs a message with your wallet");

    const step = { steps: [{ ref: "Sign message", action: "press" }] };
    expect((await agent.act(step)).ok).toBe(false);
    approve = true;
    expect((await agent.act(step)).ok).toBe(true);
    expect(await screen.findByRole("button", { name: "Copy signature" })).toBeInTheDocument();
    expect(named("Copy signature")?.confirm).toBeUndefined();
  });

  it("names an approval by its token and asks before it", async () => {
    approve = false;
    const config = createTestConfig({
      rpc: { ...fakeChainRpc(), eth_call: erc20CallRpc({ allowance: 0n }) },
    });
    renderWithWagmi(
      <ApproveButton token={usdc} spender={router} amount={parseUnits("50", 6)} chainId={1}>
        Swap
      </ApproveButton>,
      { config },
    );
    await act(() => connectMock(config));
    await screen.findByRole("button", { name: "Approve USDC" });
    expect(named("Approve USDC")?.confirm).toBe(`Approve USDC: lets ${router} spend up to 50 USDC`);
    expect((await agent.act({ steps: [{ ref: "Approve USDC", action: "press" }] })).ok).toBe(false);
  });

  it.each([
    [
      { unlimited: true },
      usdc,
      `Approve USDC: lets ${router} spend all of your USDC, with no limit`,
    ],
    [
      {},
      { address: usdc.address, symbol: "USDC" },
      `Approve USDC: lets ${router} spend up to 50000000 base units of USDC`,
    ],
  ])("states the approval's size in its confirm (%o)", async (props, token, sentence) => {
    const config = createTestConfig({
      rpc: { ...fakeChainRpc(), eth_call: erc20CallRpc({ allowance: 0n }) },
    });
    renderWithWagmi(
      <ApproveButton
        token={token}
        spender={router}
        amount={parseUnits("50", 6)}
        chainId={1}
        {...props}
      >
        Swap
      </ApproveButton>,
      { config },
    );
    await act(() => connectMock(config));
    await screen.findByRole("button", { name: "Approve USDC" });
    expect(named("Approve USDC")?.confirm).toBe(sentence);
  });

  it("leaves an empty toast region out", async () => {
    // The shared queue is empty here: each test clears it.
    renderWithWagmi(<Toaster />);
    expect(onPage()).toEqual([]);
  });

  it("reads a transaction toast and its explorer link", async () => {
    const chain = fakeChainRpc();
    function Track() {
      const toastTransaction = useTransactionToast();
      useEffect(() => {
        toastTransaction(fakeTxHash, { description: "Agent test send" });
      }, [toastTransaction]);
      return <Toaster />;
    }
    renderWithWagmi(<Track />, { config: createTestConfig({ rpc: chain }) });

    // One toast is listed under its title; several under the region's name,
    // Notifications, with every toast's text. The shared queue is global, so
    // earlier tests' toasts may still be showing.
    const toastText = () =>
      onPage().find((item) => item.component === "toast" && item.text?.includes("Agent test send"));
    const entry = await waitFor(() => {
      expect(toastText()).toBeDefined();
      return toastText()!;
    });
    expect(entry.label).toBeTruthy();
    expect(entry.text).toContain("Transaction pending");
    expect(entry.buttons).toContain("View");

    // Let it settle before the host unmounts.
    (chain.eth_sendTransaction as (p: unknown) => unknown)([
      { from: testAccounts[0], to: testAccounts[1] },
    ]);
    const settled = await screen.findByText("Agent test send", {}, { timeout: 5000 });
    await waitFor(
      () => expect(settled.closest("[data-slot=toast]")).toHaveTextContent("Transaction confirmed"),
      { timeout: 5000 },
    );
  });
});
