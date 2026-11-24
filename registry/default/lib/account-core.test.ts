import { describe, expect, it } from "vitest";
import { connectMock, createTestConfig, testAccounts } from "../../../test/wagmi";
import { accountDisplayName, createConnectedAccount, walletButtonPhase } from "./account-core";

describe("createConnectedAccount", () => {
  it("follows the connection and switches between wallets without any framework", async () => {
    const config = createTestConfig({ wallets: [[testAccounts[0]], [testAccounts[1]]] });
    const account = createConnectedAccount(config);
    const stop = account.subscribe(() => {});

    expect(account.get().status).toBe("disconnected");
    await connectMock(config, 0);
    await connectMock(config, 1);
    expect(account.get().address).toBe(testAccounts[1]);
    expect(account.get().otherAccounts.map((o) => o.address)).toEqual([testAccounts[0]]);

    expect(await account.switchAccount(account.get().otherAccounts[0]!.connector)).toBe(true);
    expect(account.get()).toMatchObject({ address: testAccounts[0], isSwitching: false });

    expect(await account.disconnect()).toBe(true);
    expect(account.get().address).toBe(testAccounts[1]);
    expect(account.get().isDisconnecting).toBe(false);
    stop();
  });
});

describe("account helpers", () => {
  it("names the account by ENS, then by its truncated address", () => {
    expect(accountDisplayName(testAccounts[0], "vitalik.eth")).toBe("vitalik.eth");
    expect(accountDisplayName(testAccounts[0], null)).toBe("0xd8dA…6045");
    expect(accountDisplayName(undefined, null)).toBeUndefined();
  });

  it("restores before it knows the connection", () => {
    expect(walletButtonPhase("connected", false)).toBe("restoring");
    expect(walletButtonPhase("reconnecting", true)).toBe("restoring");
    expect(walletButtonPhase("connected", true)).toBe("connected");
    expect(walletButtonPhase("disconnected", true)).toBe("disconnected");
  });
});
