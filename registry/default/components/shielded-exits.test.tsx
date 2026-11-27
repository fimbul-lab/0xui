import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseUnits } from "viem";
import type { Address, Hash } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  connectMock,
  createTestConfig,
  fakeChainRpc,
  renderWithWagmi,
  testAccounts,
} from "../../../test/wagmi";
import { MOCK_SHIELD_CONTRACT, createMockShieldedEngine } from "../lib/mock-shielded-engine";
import type { MockShieldedEngine } from "../lib/mock-shielded-engine";
import type { ShieldedExit } from "../lib/shielded-engine";
import { ShieldedExits, shieldedExitBlocker } from "./shielded-exits";
import { ShieldedProvider } from "./shielded-provider";

const tkn = {
  address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  symbol: "TKN",
  decimals: 18,
} as const;
const OTHER: Address = "0x9999999999999999999999999999999999999999";

describe("shieldedExitBlocker", () => {
  it("asks for the wallet that shielded the funds, on the right network", () => {
    const base = {
      address: testAccounts[0],
      depositor: testAccounts[0],
      walletChainId: 1,
      chainId: 1,
    };
    expect(shieldedExitBlocker({ ...base, address: undefined })).toEqual({
      label: "Connect wallet",
      action: "connect",
    });
    expect(shieldedExitBlocker({ ...base, depositor: OTHER })).toEqual({
      label: "Switch wallet to 0x9999…9999",
    });
    expect(shieldedExitBlocker({ ...base, walletChainId: 10, chainName: "Ethereum" })).toEqual({
      label: "Switch to Ethereum",
      action: "switch-chain",
    });
    // An engine that does not say who shielded them lets any wallet send.
    expect(shieldedExitBlocker({ ...base, depositor: undefined })).toBeUndefined();
    expect(shieldedExitBlocker(base)).toBeUndefined();
  });
});

describe("ShieldedExits", () => {
  const root = () => document.querySelector("[data-slot=shielded-exits]");
  const button = (name: string | RegExp) =>
    screen.findByRole("button", { name }, { timeout: 5000 });

  /** `failFirstProof` makes the first exit proof fail with that message, as one that ran out of memory would. */
  async function setup({
    depositor = testAccounts[0],
    connect = true,
    failFirstProof,
  }: { depositor?: Address; connect?: boolean; failFirstProof?: string } = {}) {
    const user = userEvent.setup();
    const mock = createMockShieldedEngine({
      speed: Infinity,
      funds: [
        { token: tkn.address, amount: parseUnits("3", 18), state: "restricted", depositor },
        { token: tkn.address, amount: parseUnits("10", 18) },
      ],
    });
    let failure = failFirstProof;
    const engine: MockShieldedEngine = {
      ...mock,
      async prepareExit(...args) {
        const message = failure;
        failure = undefined;
        if (message !== undefined) {
          throw new Error(message);
        }
        if (!mock.prepareExit) {
          throw new Error("The mock engine has no exits.");
        }
        return mock.prepareExit(...args);
      },
    };
    await engine.account.unlock("password");
    await engine.sync(1);
    const sends: Array<{ to: string }> = [];
    const chain = fakeChainRpc({});
    const send = chain.eth_sendTransaction as (params: unknown) => unknown;
    const config = createTestConfig({
      rpc: {
        ...chain,
        eth_sendTransaction: (params: [{ to: string }]) => {
          sends.push(params[0]);
          return send(params);
        },
      },
    });
    /** `firstSubmit` resolves with the first call to `onSubmitted`. */
    const { promise: firstSubmit, resolve } = Promise.withResolvers<[Hash, ShieldedExit]>();
    const onSubmitted = (hash: Hash, exit: ShieldedExit) => resolve([hash, exit]);
    renderWithWagmi(
      <ShieldedProvider engine={engine}>
        <ShieldedExits chainId={1} tokens={[tkn]} onSubmitted={onSubmitted} />
      </ShieldedProvider>,
      { config },
    );
    if (connect) {
      await act(() => connectMock(config));
    }
    return { user, engine, firstSubmit, sends };
  }

  it("renders nothing when there is nothing to exit", async () => {
    const engine = createMockShieldedEngine({ speed: Infinity });
    await engine.account.unlock("password");
    await engine.sync(1);
    renderWithWagmi(
      <ShieldedProvider engine={engine}>
        <ShieldedExits chainId={1} tokens={[tkn]} />
      </ShieldedProvider>,
      { config: createTestConfig({ rpc: fakeChainRpc({}) }) },
    );
    expect(root()).toBeNull();
  });

  it("lists restricted funds only, and warns before anything starts", async () => {
    const { user, engine } = await setup();
    const prepare = vi.spyOn(engine, "prepareExit");
    expect(root()!.querySelectorAll("li[data-state]")).toHaveLength(1);
    expect(root()).toHaveTextContent(/3\s*TKN/);
    expect(root()).toHaveTextContent("Restricted · from");

    await user.click(await button("Exit publicly"));
    expect(screen.getByRole("note")).toHaveTextContent("Public and final.");
    expect(prepare).not.toHaveBeenCalled();
    expect(await button("Prepare exit")).toBeEnabled();
  });

  it("makes the proof on one click and opens the wallet on the next", async () => {
    const { user, engine, firstSubmit, sends } = await setup();
    await user.click(await button("Exit publicly"));
    await user.click(await button("Prepare exit"));

    const send = await button("Send exit from wallet");
    expect(root()).toHaveAttribute("data-phase", "ready");
    expect(sends).toHaveLength(0);

    await user.click(send);
    const [hash, exit] = await firstSubmit;
    expect(sends[0]!.to.toLowerCase()).toBe(MOCK_SHIELD_CONTRACT.toLowerCase());
    expect(exit).toMatchObject({ amount: parseUnits("3", 18), state: "restricted" });
    expect(document.querySelector("[data-slot=transaction-status]")).toHaveTextContent(
      "Exit TKN publicly",
    );

    // The funds leave the list once the engine sees them gone.
    await act(() => engine.simulate.exit(exit.id));
    expect(root()!.querySelectorAll("li[data-state=restricted]")).toHaveLength(0);
    expect(hash).toMatch(/^0x/);
  });

  it("asks for the depositor's wallet before proving anything", async () => {
    const { user, engine } = await setup({ depositor: OTHER });
    const prepare = vi.spyOn(engine, "prepareExit");
    await user.click(await button("Exit publicly"));
    expect(await button("Switch wallet to 0x9999…9999")).toBeDisabled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("offers to connect when no wallet is connected", async () => {
    const { user } = await setup({ connect: false });
    await user.click(await button("Exit publicly"));
    expect(await button("Connect wallet")).toBeEnabled();
  });

  it("shows a failed proof and tries again", async () => {
    const { user } = await setup({ failFirstProof: "Out of memory" });
    await user.click(await button("Exit publicly"));
    await user.click(await button("Prepare exit"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Out of memory");
    expect(root()).toHaveAttribute("data-phase", "error");

    await user.click(await button("Try again"));
    expect(await button("Send exit from wallet")).toBeEnabled();
  });

  it("closes without sending", async () => {
    const { user, sends } = await setup();
    await user.click(await button("Exit publicly"));
    await user.click(await button("Prepare exit"));
    await button("Send exit from wallet");
    await user.click(await button("Close"));
    expect(root()).toHaveAttribute("data-phase", "idle");
    expect(await button("Exit publicly")).toBeEnabled();
    expect(sends).toHaveLength(0);
  });
});
