import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseUnits } from "viem";
import type { Hash } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  connectMock,
  createTestConfig,
  fakeChainRpc,
  renderWithWagmi,
  testAccounts,
} from "../../../test/wagmi";
import { createMockShieldedEngine } from "../lib/mock-shielded-engine";
import type { UnshieldDraft } from "../lib/shielded-engine";
import { ShieldedProvider } from "./shielded-provider";
import type { Token } from "./token-select";
import { Unshield, unshieldBlocker } from "./unshield";
import type { UnshieldProps } from "./unshield";

type MockOptions = Parameters<typeof createMockShieldedEngine>[0];

const tkn: Token = {
  chainId: 1,
  address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  symbol: "TKN",
  name: "Token",
  decimals: 18,
};
const RECIPIENT = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

describe("unshieldBlocker", () => {
  it("names the blocker in the order people meet it", () => {
    const base = {
      accountStatus: "unlocked",
      token: tkn,
      amount: 1n,
      spendable: 5n,
      recipient: RECIPIENT,
    } as const;
    expect(unshieldBlocker({ ...base, accountStatus: "none" })).toBe(
      "Create a private account first",
    );
    expect(unshieldBlocker({ ...base, accountStatus: "locked" })).toBe(
      "Unlock your private account",
    );
    expect(unshieldBlocker({ ...base, token: undefined })).toBe("Select a token");
    expect(unshieldBlocker({ ...base, amount: undefined })).toBe("Enter an amount");
    expect(unshieldBlocker({ ...base, spendable: undefined })).toBe("Scanning private balance…");
    expect(unshieldBlocker({ ...base, amount: 6n })).toBe("Insufficient private TKN");
    expect(unshieldBlocker({ ...base, recipient: undefined })).toBe("Enter a recipient");
    expect(unshieldBlocker(base)).toBeUndefined();
  });
});

describe("Unshield", () => {
  const root = () => document.querySelector("[data-slot=unshield]")!;
  const phase = () => root().getAttribute("data-phase");
  const amount = () => screen.getByRole("textbox", { name: /^Amount to unshield in / });
  const recipient = () => screen.getByRole("textbox", { name: "Recipient address" });
  const button = (name: string | RegExp) =>
    screen.findByRole("button", { name }, { timeout: 5000 });

  /**
   * Rendered with 10 TKN spendable. No wallet is connected unless asked.
   */
  async function setup({
    engine: engineOptions,
    connect = false,
    ...props
  }: Partial<UnshieldProps> & { engine?: MockOptions; connect?: boolean } = {}) {
    const user = userEvent.setup();
    const engine = createMockShieldedEngine({
      speed: Infinity,
      funds: [{ token: tkn.address, amount: parseUnits("10", 18) }],
      ...engineOptions,
    });
    await engine.account.unlock("password");
    await engine.sync(1);
    const config = createTestConfig({ rpc: fakeChainRpc({}) });
    /** What `onSubmitted` was called with. `firstSubmit` resolves with the first call. */
    const submitted: Array<[Hash, UnshieldDraft]> = [];
    const { promise: firstSubmit, resolve } = Promise.withResolvers<[Hash, UnshieldDraft]>();
    const onSubmitted = (hash: Hash, draft: UnshieldDraft) => {
      submitted.push([hash, draft]);
      resolve([hash, draft]);
    };
    renderWithWagmi(
      <ShieldedProvider engine={engine}>
        <Unshield tokens={[tkn]} chainId={1} onSubmitted={onSubmitted} {...props} />
      </ShieldedProvider>,
      { config },
    );
    if (connect) {
      await act(() => connectMock(config));
    }
    return { user, engine, submitted, firstSubmit };
  }

  it("walks through what is missing, without a wallet", async () => {
    const { user } = await setup();
    expect(root()).toHaveTextContent(/10\s*TKN spendable/);
    expect(screen.getByRole("button", { name: "Enter an amount" })).toBeDisabled();

    await user.type(amount(), "20");
    expect(screen.getByRole("button", { name: "Insufficient private TKN" })).toBeDisabled();

    await user.clear(amount());
    await user.type(amount(), "4");
    expect(screen.getByRole("button", { name: "Enter a recipient" })).toBeDisabled();
    // The price shows before the recipient is in.
    const rows = within((await screen.findByText("Fee (0.25%)")).closest("dl")!);
    expect(rows.getByText("3.99")).toBeInTheDocument();
    expect(rows.getByText("Public")).toBeInTheDocument();

    await user.type(recipient(), RECIPIENT);
    expect(await button("Unshield TKN")).toBeEnabled();
  });

  it("fills the whole spendable balance with Max, and the wallet's address on request", async () => {
    const { user } = await setup({ connect: true });
    await user.click(screen.getByRole("button", { name: "Max" }));
    expect(amount()).toHaveValue("10");
    await user.click(await button("Use my wallet"));
    expect(recipient()).toHaveValue(testAccounts[0]);
    expect(await button("Unshield TKN")).toBeEnabled();
  });

  it("proves, submits and follows the transaction", async () => {
    const { user, engine, submitted, firstSubmit } = await setup();
    const submit = vi.spyOn(engine, "submit");
    await user.type(amount(), "4");
    await user.type(recipient(), RECIPIENT);
    await user.click(await button("Unshield TKN"));

    const [hash, draft] = await firstSubmit;
    expect(submitted).toHaveLength(1);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(draft).toMatchObject({
      kind: "unshield",
      chainId: 1,
      token: tkn.address,
      amount: parseUnits("4", 18),
      recipient: RECIPIENT,
    });
    expect(submit).toHaveBeenCalledTimes(1);

    // Back on the form, with the transaction followed underneath.
    expect(phase()).toBe("idle");
    expect(amount()).toHaveValue("");
    expect(document.querySelector("[data-slot=transaction-status]")).toHaveTextContent(
      "Unshield 4 TKN",
    );
    await vi.waitFor(() => expect(root()).toHaveTextContent(/6\s*TKN spendable/));
  });

  it("shows a failed proof and proves again on request", async () => {
    const { user, engine, firstSubmit } = await setup();
    engine.simulate.failNextProof("Out of memory");
    await user.type(amount(), "4");
    await user.type(recipient(), RECIPIENT);
    await user.click(await button("Unshield TKN"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Out of memory");
    expect(phase()).toBe("error");
    expect(root()).toHaveAttribute("data-error");
    // The form is locked while the unshield is open.
    expect(amount().closest("[inert]")).not.toBeNull();

    await user.click(await button("Try again"));
    await firstSubmit;
  });

  it("reports a failed send and lets the user go back", async () => {
    const { user, submitted } = await setup({
      engine: {
        relay: () => {
          throw new Error("The relayer is busy.");
        },
      },
    });
    await user.type(amount(), "4");
    await user.type(recipient(), RECIPIENT);
    await user.click(await button("Unshield TKN"));

    expect(await screen.findByText("The relayer is busy.")).toBeInTheDocument();
    expect(phase()).toBe("error");
    await user.click(await button("Back"));
    expect(phase()).toBe("idle");
    expect(amount()).toHaveValue("4");
    expect(submitted).toEqual([]);
  });

  it("asks before sending when the proof's fee is higher than the one shown", async () => {
    const { user, engine, firstSubmit } = await setup();
    // The price shown is half the fee the proof then commits to.
    engine.simulate.staleQuotes();
    const submit = vi.spyOn(engine, "submit");
    await user.type(amount(), "4");
    await user.type(recipient(), RECIPIENT);
    await user.click(await button("Unshield TKN"));

    const confirm = await button("Unshield at the new fee");
    expect(phase()).toBe("review");
    expect(submit).not.toHaveBeenCalled();
    // The rows now show the proof's fee, not the one quoted.
    expect(screen.getByText("Fee (0.25%)")).toBeInTheDocument();

    await user.click(confirm);
    await firstSubmit;
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("says why an amount can't be unshielded", async () => {
    const { user, engine } = await setup();
    engine.simulate.failQuotes("The most you can unshield at once is 3.");
    await user.type(amount(), "4");
    await user.type(recipient(), RECIPIENT);
    expect(await button("Can't unshield this amount")).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("The most you can unshield at once is 3.");
  });
});
