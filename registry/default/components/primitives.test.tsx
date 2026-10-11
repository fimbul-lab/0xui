import { act, screen } from "@testing-library/react";
import { parseUnits } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestConfig, renderWithWagmi } from "../../../test/wagmi";
import { Address } from "./address";
import { AddressAvatar, addressGradient } from "./address-avatar";
import { BlockNumber } from "./block-number";
import { ChainBadge } from "./chain-badge";
import { CopyButton } from "./copy-button";
import { ExplorerLink } from "./explorer-link";
import { GasPrice, formatGasPrice, gasTone } from "./gas-price";
import { TokenAmount, formatFiat } from "./token-amount";
import { TokenIcon } from "./token-icon";

const vitalik = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

afterEach(() => vi.unstubAllGlobals());

describe("CopyButton", () => {
  it("copies, confirms, and announces", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const onCopy = vi.fn();
    renderWithWagmi(
      <CopyButton value="0xabc" label="Copy address" onCopy={onCopy} />
    );

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
      <ExplorerLink address={vitalik} chainId={11155111}>
        Sepolia
      </ExplorerLink>
    );
    expect(screen.getByRole("link", { name: /sepolia/i })).toHaveAttribute(
      "href",
      `https://sepolia.etherscan.io/address/${vitalik}`
    );
  });

  it("renders plain text for a chain without an explorer", () => {
    renderWithWagmi(
      <ExplorerLink block={1n} chainId={999}>
        Block 1
      </ExplorerLink>
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
    expect(
      screen.getByRole("button", { name: "Copy address" })
    ).toBeInTheDocument();
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
      `https://etherscan.io/address/${vitalik}`
    );
  });
});

describe("AddressAvatar", () => {
  it("derives a stable gradient per address", () => {
    expect(addressGradient(vitalik)).toBe(addressGradient(vitalik.toLowerCase()));
    expect(addressGradient(vitalik)).not.toBe(
      addressGradient("0x71C7656EC7ab88b098defB751B7401B5f6d8976F")
    );
  });

  it("renders the gradient fallback without ENS", () => {
    const { container } = renderWithWagmi(
      <AddressAvatar address={vitalik} ens={false} size={32} />
    );
    const root = container.querySelector('[data-slot="avatar"]');
    expect(root).toHaveStyle({ width: "32px", height: "32px" });
    expect(root).toHaveAttribute("aria-hidden");
  });
});

describe("ChainBadge", () => {
  it("names the chain from the wagmi config", () => {
    renderWithWagmi(<ChainBadge chainId={11155111} />);
    expect(screen.getByText("Sepolia")).toBeInTheDocument();
  });

  it("falls back for unknown chains and keeps the label accessible when icon-only", () => {
    renderWithWagmi(<ChainBadge chainId={424242} iconOnly />);
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
      />
    );
    const amount = screen.getByTitle("1234.567891 USDC");
    expect(amount).toHaveTextContent("1,234.5678USDC");
  });

  it("shows a fiat value when given a price", () => {
    renderWithWagmi(
      <TokenAmount
        value={parseUnits("2", 18)}
        decimals={18}
        price={3000}
        locale="en-US"
      />
    );
    expect(screen.getByText("$6,000.00")).toBeInTheDocument();
  });

  it("formats fiat in other currencies", () => {
    expect(
      formatFiat(parseUnits("1.5", 6), 6, 2, { currency: "EUR", locale: "de-DE" })
    ).toBe("3,00\u00a0€");
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
    renderWithWagmi(
      <GasPrice refreshInterval={false} thresholds={{ low: 5, high: 30 }} />,
      { config }
    );
    const price = await screen.findByText(/50 gwei/);
    expect(price.closest("[data-tone]")).toHaveAttribute("data-tone", "high");
  });
});
