import {
  BaseError,
  ContractFunctionRevertedError,
  HttpRequestError,
  InsufficientFundsError,
  SwitchChainError,
  UserRejectedRequestError,
  erc20Abi,
  parseUnits,
} from "viem";
import { mainnet } from "viem/chains";
import { describe, expect, it } from "vitest";
import {
  agentConfirmText,
  encodeBech32m,
  errorCode,
  formatTokenAmount,
  getExplorerUrl,
  isShieldedAddress,
  isUserRejection,
  parseAmount,
  truncateAddress,
} from "./0xui-utils";

describe("truncateAddress", () => {
  it("checksums and truncates", () => {
    expect(truncateAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045")).toBe("0xd8dA…6045");
  });

  it("respects custom lengths", () => {
    expect(
      truncateAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", {
        start: 4,
        end: 6,
      }),
    ).toBe("0xd8…A96045");
  });

  it("leaves short strings alone", () => {
    expect(truncateAddress("0x1234")).toBe("0x1234");
  });
});

describe("formatTokenAmount", () => {
  const usdc = (n: string) => parseUnits(n, 6);

  it("formats with grouping and max decimals", () => {
    expect(formatTokenAmount(usdc("1234.56789"), 6, { locale: "en-US" })).toBe("1,234.5678");
  });

  it("rounds toward zero, never up", () => {
    expect(formatTokenAmount(usdc("0.99999"), 6, { locale: "en-US" })).toBe("0.9999");
  });

  it("keeps precision beyond Number.MAX_SAFE_INTEGER", () => {
    expect(formatTokenAmount(123_456_789_012_345_678_901_234n, 0, { locale: "en-US" })).toBe(
      "123,456,789,012,345,678,901,234",
    );
  });

  it("shows dust as a lower bound", () => {
    expect(formatTokenAmount(1n, 18, { locale: "en-US" })).toBe("<0.0001");
  });

  it("shows zero as zero", () => {
    expect(formatTokenAmount(0n, 18, { locale: "en-US" })).toBe("0");
  });

  it("supports compact notation", () => {
    expect(formatTokenAmount(usdc("1250000"), 6, { compact: true, locale: "en-US" })).toBe("1.25M");
  });
});

describe("parseAmount", () => {
  it.each([
    ["1.5", 18, parseUnits("1.5", 18)],
    [".5", 18, parseUnits("0.5", 18)],
    ["5.", 18, parseUnits("5", 18)],
    [" $1,000.25 ", 6, parseUnits("1000.25", 6)],
    ["1.000,25", 6, parseUnits("1000.25", 6)],
    ["1,5", 6, parseUnits("1.5", 6)],
    ["1,000", 6, parseUnits("1000", 6)],
    ["1,000,000", 6, parseUnits("1000000", 6)],
    ["0.1234567", 6, parseUnits("0.123456", 6)],
    ["0", 6, 0n],
  ])("parses %j with %i decimals", (input, decimals, expected) => {
    expect(parseAmount(input, decimals)).toBe(expected);
  });

  it.each(["", " ", ".", "abc", "1.2.3", "-1", "1e18"])("rejects %j", (input) => {
    expect(parseAmount(input, 18)).toBeUndefined();
  });
});

describe("getExplorerUrl", () => {
  it("builds address, tx and block links", () => {
    expect(getExplorerUrl(mainnet, { address: "0xabc" })).toBe(
      "https://etherscan.io/address/0xabc",
    );
    expect(getExplorerUrl(mainnet, { tx: "0xdef" })).toBe("https://etherscan.io/tx/0xdef");
    expect(getExplorerUrl(mainnet, { block: 1n })).toBe("https://etherscan.io/block/1");
  });

  it("returns undefined without an explorer", () => {
    expect(getExplorerUrl({ blockExplorers: undefined }, { tx: "0x" })).toBe(undefined);
    expect(getExplorerUrl(undefined, { tx: "0x" })).toBe(undefined);
  });
});

describe("isUserRejection", () => {
  it("detects a rejection, including when wrapped", () => {
    const rejected = new UserRejectedRequestError(new Error("nope"));
    expect(isUserRejection(rejected)).toBe(true);
    expect(isUserRejection(new SwitchChainError(rejected))).toBe(true);
    expect(isUserRejection({ code: 4001 })).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isUserRejection(new SwitchChainError(new Error("boom")))).toBe(false);
    expect(isUserRejection(new Error("boom"))).toBe(false);
    expect(isUserRejection(null)).toBe(false);
  });
});

describe("isShieldedAddress", () => {
  // From the Railgun engine's own address tests.
  const real = [
    "0zk1q8hxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kfrv7j6fe3z53llhxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kg0zpzts",
    "0zk1qyqqqqdl645pcpreh6dga7xa3w4dm9c3tzv6ntesk0fy2kzr476pkumpd9kxwatw8qqqqqdl645pcpreh6dga7xa3w4dm9c3tzv6ntesk0fy2kzr476pkwrfm4m",
    "0zk1qyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqunpd9kxwatwqyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqhshkca",
  ];

  it("accepts real addresses", () => {
    for (const address of real) {
      expect(isShieldedAddress(address)).toBe(true);
    }
  });

  it("rejects a single wrong character anywhere", () => {
    const address = real[0]!;
    for (const index of [4, 40, 90, 126]) {
      const swapped = address[index] === "q" ? "p" : "q";
      const typo = address.slice(0, index) + swapped + address.slice(index + 1);
      expect(isShieldedAddress(typo)).toBe(false);
    }
  });

  it("rejects the wrong length, prefix, casing or alphabet", () => {
    const address = real[0]!;
    expect(isShieldedAddress(address.slice(0, -1))).toBe(false);
    expect(isShieldedAddress(`${address}q`)).toBe(false);
    expect(isShieldedAddress(address.replace("0zk", "0zz"))).toBe(false);
    expect(isShieldedAddress(address.toUpperCase())).toBe(false);
    // "b", "i" and "o" are not in the alphabet.
    expect(isShieldedAddress(address.slice(0, 20) + "b" + address.slice(21))).toBe(false);
    expect(isShieldedAddress("")).toBe(false);
    expect(isShieldedAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(false);
  });
});

describe("encodeBech32m", () => {
  const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const words = (text: string) => Array.from(text, (char) => alphabet.indexOf(char));

  it("matches the BIP-350 test vectors", () => {
    expect(encodeBech32m("a", [])).toBe("a1lqfn3a");
    expect(encodeBech32m("abcdef", words("l7aum6echk45nj3s0wdvt2fg8x9yrzpq"))).toBe(
      "abcdef1l7aum6echk45nj3s0wdvt2fg8x9yrzpqzd3ryx",
    );
  });

  it("round-trips through isShieldedAddress", () => {
    const address = encodeBech32m("0zk", [0, ...Array.from({ length: 116 }, (_, i) => i % 32)]);
    expect(address).toHaveLength(127);
    expect(isShieldedAddress(address)).toBe(true);
  });
});

describe("errorCode", () => {
  it("reads cancelled and reverted from the phase", () => {
    expect(errorCode("cancelled")).toBe("user-rejected");
    expect(errorCode("reverted")).toBe("reverted");
    expect(errorCode("pending", new Error("ignored"))).toBeUndefined();
  });

  it("classifies wrapped viem errors", () => {
    const rejected = new SwitchChainError(new UserRejectedRequestError(new Error("nope")));
    expect(errorCode("error", rejected)).toBe("user-rejected");
    expect(
      errorCode("error", new BaseError("send failed", { cause: new InsufficientFundsError() })),
    ).toBe("insufficient-funds");
    expect(
      errorCode(
        "error",
        new BaseError("call failed", {
          cause: new ContractFunctionRevertedError({ abi: erc20Abi, functionName: "transfer" }),
        }),
      ),
    ).toBe("reverted");
    expect(errorCode("error", new HttpRequestError({ url: "https://rpc.example" }))).toBe(
      "network",
    );
  });

  it("reads wagmi errors by name, and falls back to unknown", () => {
    const mismatch = Object.assign(new Error("wrong chain"), {
      name: "ConnectorChainMismatchError",
    });
    expect(errorCode("error", mismatch)).toBe("wrong-chain");
    expect(errorCode("error", new Error("odd"))).toBe("unknown");
    expect(errorCode("error")).toBe("unknown");
  });
});

describe("agentConfirmText", () => {
  it("leads with a text label", () => {
    expect(agentConfirmText("Send 1 ETH", "sends a transaction")).toBe(
      "Send 1 ETH: sends a transaction",
    );
    expect(agentConfirmText(null, "sends a transaction")).toBe("Sends a transaction");
  });
});
