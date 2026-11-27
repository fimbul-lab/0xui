import { describe, expect, it } from "vitest";
import { sendBlocker, sendConfirmText, sendRequest } from "./send-core";
import { NATIVE_TOKEN_ADDRESS } from "./token-list";
import type { TokenInfo } from "./token-list";

const eth: TokenInfo = {
  chainId: 1,
  address: NATIVE_TOKEN_ADDRESS,
  symbol: "ETH",
  name: "Ether",
  decimals: 18,
};
const recipient = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";

describe("send", () => {
  it("is ready once recipient and amount are valid", () => {
    const draft = { recipient, token: eth, amount: 1n } as const;
    expect(sendBlocker(draft, { recipientPhase: "valid", insufficient: false })).toBeUndefined();
    expect(
      sendBlocker({ ...draft, amount: 0n }, { recipientPhase: "valid", insufficient: false }),
    ).toBe("Enter an amount");
    expect(
      sendBlocker(
        { ...draft, recipient: undefined },
        { recipientPhase: "not-found", insufficient: false },
      ),
    ).toBe("Enter a valid recipient");
  });

  it("sends value for the native currency", () => {
    expect(sendRequest({ recipient, amount: 5n, token: eth })).toEqual({
      transaction: { to: recipient, value: 5n },
    });
  });
});

describe("sendConfirmText", () => {
  it("names the exact amount, the full recipient and the network", () => {
    expect(
      sendConfirmText({
        amount: 1_500_000_000_000_000_000n,
        token: eth,
        recipient,
        chainName: "Base",
      }),
    ).toBe(`Sends 1.5 ETH from your wallet to ${recipient} on Base`);
    expect(sendConfirmText({ amount: 1n, token: eth, recipient, ensName: "vitalik.eth" })).toBe(
      `Sends 0.000000000000000001 ETH from your wallet to vitalik.eth (${recipient})`,
    );
  });
});
