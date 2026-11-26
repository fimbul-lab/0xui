import { act, render, screen } from "@testing-library/react";
import { createAgent } from "@ui-sdk/react/agent";
import { parseUnits } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestConfig, renderWithWagmi } from "../../../test/wagmi";
import { Address } from "./address";
import { AddressAvatar, addressGradient } from "./address-avatar";
import { BlockNumber } from "./block-number";
import { ChainBadge } from "./chain-badge";
import { CopyButton, copyLabel } from "./copy-button";
import { ExplorerLink } from "./explorer-link";
import { GasPrice, formatGasPrice, gasTone } from "./gas-price";
import { MorphText } from "./morph-text";
import { ResponsiveDialog } from "./responsive-dialog";
import type { ResponsiveDialogProps } from "./responsive-dialog";
import { TokenAmount, formatFiat } from "./token-amount";
import { TokenIcon } from "./token-icon";

const vitalik = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CopyButton", () => {
  it("copies, confirms, and announces", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const onCopy = vi.fn();
    renderWithWagmi(<CopyButton value="0xabc" label="Copy address" onCopy={onCopy} />);

    // Not userEvent: it replaces navigator.clipboard with its own stub.
    await act(async () => {
      screen.getByRole("button", { name: "Copy address" }).click();
    });

    expect(writeText).toHaveBeenCalledWith("0xabc");
    expect(onCopy).toHaveBeenCalledWith("0xabc");
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
    expect(screen.getByRole("button")).toHaveAttribute("data-copied");
  });

  it("does not report a copy the clipboard refused", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const onCopy = vi.fn();
    renderWithWagmi(<CopyButton value="0xabc" onCopy={onCopy} />);

    await act(async () => {
      screen.getByRole("button").click();
    });

    expect(onCopy).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});

describe("ExplorerLink", () => {
  it("links to the current chain's explorer in a new tab", () => {
    renderWithWagmi(<ExplorerLink tx="0x123" />);
    const link = screen.getByRole("link", { name: /view on etherscan/i });
    expect(link).toHaveAttribute("href", "https://etherscan.io/tx/0x123");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("uses chainId when given", () => {
    renderWithWagmi(
      <ExplorerLink address={vitalik} chainId={11_155_111}>
        Sepolia
      </ExplorerLink>,
    );
    expect(screen.getByRole("link", { name: /sepolia/i })).toHaveAttribute(
      "href",
      `https://sepolia.etherscan.io/address/${vitalik}`,
    );
  });

  it("renders plain text for a chain without an explorer", () => {
    renderWithWagmi(
      <ExplorerLink block={1n} chainId={999}>
        Block 1
      </ExplorerLink>,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Block 1")).toBeInTheDocument();
  });
});

describe("Address", () => {
  it("shows the checksummed, truncated address with the full one for screen readers", () => {
    const lowercase = vitalik.toLowerCase() as `0x${string}`;
    renderWithWagmi(<Address address={lowercase} ens={false} />);
    expect(screen.getByText("0xd8dA…6045")).toBeInTheDocument();
    expect(screen.getByText(vitalik)).toHaveClass("sr-only");
    // Named for its address, so several Address components stay apart.
    expect(screen.getByRole("button", { name: "Copy address 0xd8dA…6045" })).toBeInTheDocument();
  });

  it("prefers a given name", () => {
    renderWithWagmi(<Address address={vitalik} name="vitalik.eth" />);
    expect(screen.getByText("vitalik.eth")).toBeInTheDocument();
    expect(screen.getByText(`vitalik.eth, ${vitalik}`)).toHaveClass("sr-only");
  });

  it("falls back to the address when ENS lookup fails", async () => {
    renderWithWagmi(<Address address={vitalik} />);
    expect(await screen.findByText("0xd8dA…6045")).toBeInTheDocument();
  });

  it("links to the explorer when asked", () => {
    renderWithWagmi(<Address address={vitalik} ens={false} explorer />);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `https://etherscan.io/address/${vitalik}`,
    );
  });
});

describe("AddressAvatar", () => {
  it("derives a stable gradient per address", () => {
    expect(addressGradient(vitalik)).toBe(addressGradient(vitalik.toLowerCase()));
    expect(addressGradient(vitalik)).not.toBe(
      addressGradient("0x71C7656EC7ab88b098defB751B7401B5f6d8976F"),
    );
  });

  it("renders the gradient fallback without ENS", () => {
    const { container } = renderWithWagmi(
      <AddressAvatar address={vitalik} ens={false} size={32} />,
    );
    const root = container.querySelector('[data-slot="avatar"]');
    expect(root).toHaveStyle({ width: "32px", height: "32px" });
    expect(root).toHaveAttribute("aria-hidden");
  });
});

describe("ChainBadge", () => {
  it("names the chain from the wagmi config", () => {
    renderWithWagmi(<ChainBadge chainId={11_155_111} />);
    expect(screen.getByText("Sepolia")).toBeInTheDocument();
  });

  it("falls back for unknown chains and keeps the label accessible when icon-only", () => {
    renderWithWagmi(<ChainBadge chainId={424_242} iconOnly />);
    expect(screen.getByText("Chain 424242")).toHaveClass("sr-only");
  });
});

describe("TokenIcon", () => {
  it("is labelled by its symbol", () => {
    renderWithWagmi(<TokenIcon symbol="USDC" chainId={1} size={40} />);
    expect(screen.getByRole("img", { name: "USDC" })).toHaveStyle({
      width: "40px",
    });
  });
});

describe("TokenAmount", () => {
  it("formats the amount and keeps the exact value on hover", () => {
    renderWithWagmi(
      <TokenAmount
        value={parseUnits("1234.567891", 6)}
        decimals={6}
        symbol="USDC"
        locale="en-US"
      />,
    );
    const amount = screen.getByTitle("1234.567891 USDC");
    // A real space between amount and symbol for screen readers and agents.
    expect(amount.textContent).toBe("1,234.5678 USDC");
  });

  it("shows a fiat value when given a price", () => {
    renderWithWagmi(
      <TokenAmount value={parseUnits("2", 18)} decimals={18} price={3000} locale="en-US" />,
    );
    expect(screen.getByText("$6,000.00")).toBeInTheDocument();
  });

  it("formats fiat in other currencies", () => {
    expect(formatFiat(parseUnits("1.5", 6), 6, 2, { currency: "EUR", locale: "de-DE" })).toBe(
      "3,00\u00a0€",
    );
  });
});

describe("BlockNumber", () => {
  it("shows the latest block once loaded", async () => {
    const config = createTestConfig({ rpc: { eth_blockNumber: "0x1406f40" } });
    renderWithWagmi(<BlockNumber watch={false} />, { config });

    expect(screen.getByText("Loading block…")).toBeInTheDocument();
    const value = await screen.findByText("21,000,000");
    expect(value.closest("[data-phase]")).toHaveAttribute("data-phase", "live");
  });

  it("reports an unreachable RPC", async () => {
    renderWithWagmi(<BlockNumber watch={false} />);
    expect(await screen.findByText("RPC unavailable")).toBeInTheDocument();
  });
});

describe("GasPrice", () => {
  it("formats gwei with three significant digits", () => {
    expect(formatGasPrice(42_123_456_789n, "en-US")).toBe("42.1");
    expect(formatGasPrice(12_345_678n, "en-US")).toBe("0.0123");
  });

  it("classifies against thresholds", () => {
    const t = { low: 5, high: 30 };
    expect(gasTone(1_000_000_000n, t)).toBe("low");
    expect(gasTone(10_000_000_000n, t)).toBe("medium");
    expect(gasTone(50_000_000_000n, t)).toBe("high");
  });

  it("shows the price with its tone", async () => {
    const config = createTestConfig({ rpc: { eth_gasPrice: "0xba43b7400" } });
    renderWithWagmi(<GasPrice refreshInterval={false} thresholds={{ low: 5, high: 30 }} />, {
      config,
    });
    const price = await screen.findByText(/50 gwei/);
    expect(price.closest("[data-tone]")).toHaveAttribute("data-tone", "high");
  });
});

describe("MorphText", () => {
  it("shows text and follows it when it changes", () => {
    const { rerender } = render(<MorphText>Confirm in wallet…</MorphText>);
    expect(screen.getByText("Confirm in wallet…")).toBeInTheDocument();

    rerender(<MorphText>Pending…</MorphText>);
    expect(screen.getByText("Pending…")).toBeInTheDocument();
    expect(screen.queryByText("Confirm in wallet…")).not.toBeInTheDocument();
  });

  it("renders numbers", () => {
    render(<MorphText>{42}</MorphText>);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("joins mixed text into one label", () => {
    const symbol = "USDC";
    render(<MorphText>Approve {symbol}</MorphText>);
    expect(screen.getByText("Approve USDC")).toBeInTheDocument();
  });

  it("renders elements as they are", () => {
    render(
      <MorphText>
        <strong>Swap</strong>
      </MorphText>,
    );
    expect(screen.getByText("Swap").tagName).toBe("STRONG");
  });
});

describe("ResponsiveDialog", () => {
  const dialog = (props: Partial<ResponsiveDialogProps>) => (
    <ResponsiveDialog
      open
      onOpenChange={() => {}}
      title="Slippage"
      description="Choose how much the price may move."
      data-phase="idle"
      {...props}
    >
      <p>Content</p>
    </ResponsiveDialog>
  );

  it("is a dialog named by its title and described for screen readers", () => {
    render(dialog({}));
    const content = screen.getByRole("dialog", { name: "Slippage" });
    expect(content).toHaveAccessibleDescription("Choose how much the price may move.");
    expect(content).toHaveAttribute("data-phase", "idle");
    expect(content).toHaveAttribute("data-presentation", "dialog");
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("presents as a sheet in drawer mode", async () => {
    render(dialog({ mode: "drawer" }));
    expect(await screen.findByRole("dialog", { name: "Slippage" })).toHaveAttribute(
      "data-presentation",
      "sheet",
    );
  });

  it("follows drawerQuery in auto mode", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query === "(max-width: 767px)",
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    render(dialog({ drawerQuery: "(max-width: 767px)" }));
    expect(await screen.findByRole("dialog")).toHaveAttribute("data-presentation", "sheet");
  });

  it("reports a close", async () => {
    const onOpenChange = vi.fn();
    render(dialog({ onOpenChange }));
    await act(async () => screen.getByRole("button", { name: "Close" }).click());
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });
});

describe("agent", () => {
  const agent = createAgent();
  const onPage = () =>
    agent.snapshot().filter((entry) => !entry.offPage && entry.component !== "more");
  const hash = `0x${"ab".repeat(32)}`;

  it("names copy buttons by what they copy", () => {
    expect(copyLabel(vitalik)).toBe("Copy address");
    expect(copyLabel(hash)).toBe("Copy hash");
    expect(copyLabel("hello")).toBe("Copy");
    render(
      <>
        <CopyButton value={vitalik} />
        <CopyButton value={hash} />
      </>,
    );
    expect(onPage().map((entry) => entry.label)).toEqual(["Copy address", "Copy hash"]);
  });

  it("tells several addresses' copy buttons apart, and copies one", async () => {
    const other = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderWithWagmi(
      <>
        <Address address={vitalik} ens={false} />
        <Address address={other} ens={false} />
      </>,
    );
    expect(onPage().map((entry) => entry.label)).toEqual([
      "Copy address 0xd8dA…6045",
      "Copy address 0x71C7…976F",
    ]);
    const result = await agent.act({
      steps: [{ ref: "Copy address 0x71C7…976F", action: "press" }],
    });
    expect(result.ok, result.error?.message).toBe(true);
    expect(writeText).toHaveBeenCalledWith(other);
  });

  it("adds no unnamed entries for display components", () => {
    renderWithWagmi(
      <>
        <AddressAvatar address={vitalik} ens={false} />
        <ChainBadge chainId={1} />
        <ChainBadge chainId={424_242} chainIcon={false} />
        <TokenIcon symbol="ZZZ" chainId={1} />
        <TokenIcon symbol="ZZZ" decorative />
        <TokenAmount value={parseUnits("1.5", 6)} decimals={6} symbol="USDC" />
        <BlockNumber watch={false} />
        <GasPrice refreshInterval={false} />
        <MorphText>Text</MorphText>
      </>,
      {
        config: createTestConfig({ rpc: { eth_blockNumber: "0x10", eth_gasPrice: "0x3b9aca00" } }),
      },
    );
    expect(onPage()).toEqual([]);
    // Decorative where its symbol is written next to it, an image otherwise.
    expect(screen.getAllByRole("img", { name: "ZZZ" })).toHaveLength(1);
  });

  it("finds a ResponsiveDialog by its title and closes it by a specific name", async () => {
    const onOpenChange = vi.fn();
    render(
      <ResponsiveDialog
        open
        onOpenChange={onOpenChange}
        title="Slippage"
        description="Choose how much the price may move."
        closeLabel="Close slippage settings"
      >
        <p>Content</p>
      </ResponsiveDialog>,
    );
    const labels = onPage().map((entry) => entry.label);
    expect(labels.sort()).toEqual(["Close slippage settings", "Slippage"]);
    const result = await agent.act({
      steps: [{ ref: "Close slippage settings", action: "press" }],
    });
    expect(result.ok, result.error?.message).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });
});
