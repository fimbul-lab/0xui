import { UserRejectedRequestError, SwitchChainError, parseUnits } from "viem";
import { mainnet } from "viem/chains";
import { describe, expect, it } from "vitest";
import {
  formatTokenAmount,
  getExplorerUrl,
  isUserRejection,
  parseAmount,
  truncateAddress,
} from "./0xui-utils";

describe("truncateAddress", () => {
  it("checksums and truncates", () => {
    expect(
      truncateAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045")
    ).toBe("0xd8dA…6045");
  });

  it("respects custom lengths", () => {
    expect(
      truncateAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", {
        start: 4,
        end: 6,
      })
    ).toBe("0xd8…A96045");
  });

  it("leaves short strings alone", () => {
    expect(truncateAddress("0x1234")).toBe("0x1234");
  });
});

describe("formatTokenAmount", () => {
  const usdc = (n: string) => parseUnits(n, 6);

  it("formats with grouping and max decimals", () => {
    expect(formatTokenAmount(usdc("1234.56789"), 6, { locale: "en-US" })).toBe(
      "1,234.5678"
    );
  });

  it("rounds toward zero, never up", () => {
    expect(formatTokenAmount(usdc("0.99999"), 6, { locale: "en-US" })).toBe(
      "0.9999"
    );
  });

  it("keeps precision beyond Number.MAX_SAFE_INTEGER", () => {
    expect(
      formatTokenAmount(123456789012345678901234n, 0, { locale: "en-US" })
    ).toBe("123,456,789,012,345,678,901,234");
  });

  it("shows dust as a lower bound", () => {
    expect(formatTokenAmount(1n, 18, { locale: "en-US" })).toBe("<0.0001");
  });

  it("shows zero as zero", () => {
    expect(formatTokenAmount(0n, 18, { locale: "en-US" })).toBe("0");
  });

  it("supports compact notation", () => {
    expect(
      formatTokenAmount(usdc("1250000"), 6, { compact: true, locale: "en-US" })
    ).toBe("1.25M");
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

  it.each(["", " ", ".", "abc", "1.2.3", "-1", "1e18"])(
    "rejects %j",
    (input) => {
      expect(parseAmount(input, 18)).toBeUndefined();
    }
  );
});

describe("getExplorerUrl", () => {
  it("builds address, tx and block links", () => {
    expect(getExplorerUrl(mainnet, { address: "0xabc" })).toBe(
      "https://etherscan.io/address/0xabc"
    );
    expect(getExplorerUrl(mainnet, { tx: "0xdef" })).toBe(
      "https://etherscan.io/tx/0xdef"
    );
    expect(getExplorerUrl(mainnet, { block: 1n })).toBe(
      "https://etherscan.io/block/1"
    );
  });

  it("returns undefined without an explorer", () => {
    expect(getExplorerUrl({ blockExplorers: undefined }, { tx: "0x" })).toBe(
      undefined
    );
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
    expect(isUserRejection(new SwitchChainError(new Error("boom")))).toBe(
      false
    );
    expect(isUserRejection(new Error("boom"))).toBe(false);
    expect(isUserRejection(null)).toBe(false);
  });
});
