import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toaster } from "sonner";
import { decodeFunctionData, erc20Abi, parseUnits, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
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
import { SignMessage } from "./sign-message";
import { useTransactionToast } from "./transaction-toast";

const usdc = {
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
  symbol: "USDC",
  decimals: 6,
};
const router = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af" as Address;

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
      `Approve USDC: lets ${router} spend the USDC this action needs`,
    );
    await user.click(approve);

    expect(
      await screen.findByRole("button", { name: "Swap" }, { timeout: 5_000 }),
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
    const approved: bigint[] = [];
    const chain = fakeChainRpc();
    const send = chain.eth_sendTransaction as (p: unknown) => unknown;
    const config = createTestConfig({
      rpc: {
        ...chain,
        eth_call: erc20CallRpc({ allowance: () => allowance, decimals: 6 }),
        eth_sendTransaction: (params: [{ data: Hex }]) => {
          const { args } = decodeFunctionData({ abi: erc20Abi, data: params[0].data });
          allowance = args[1] as bigint;
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
      await screen.findByRole("button", { name: "Approve USDT" }, { timeout: 5_000 }),
    );

    expect(
      await screen.findByRole("button", { name: "Swap" }, { timeout: 5_000 }),
    ).toBeInTheDocument();
    expect(approved).toEqual([0n, parseUnits("50", 6)]);
  });
});

describe("NetworkGuard", () => {
  it("renders children when no wallet is connected", () => {
    renderWithWagmi(<NetworkGuard chainId={11155111}>Content</NetworkGuard>);
    expect(screen.getByText("Content")).toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("asks to switch, then gets out of the way", async () => {
    const user = userEvent.setup();
    const config = createTestConfig();
    renderWithWagmi(
      <NetworkGuard chainId={11155111} mode="replace">
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
    renderWithWagmi(<NetworkGuard chainId={11155111}>Content</NetworkGuard>, { config });
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
    const settled = await screen.findByText(heading, {}, { timeout: 5_000 });
    // Sonner's store is global, so earlier tests' toasts may still be showing.
    const toastEl = settled.closest("li")!;
    expect(within(toastEl).getByRole("button", { name: "View" })).toBeInTheDocument();
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
