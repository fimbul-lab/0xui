import { act, render, renderHook, screen, within } from "@testing-library/react";
import { createAgent } from "@ui-sdk/react/agent";
import type { ReactElement, ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { parseEther, parseUnits } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MOCK_TIMINGS,
  createMockShieldedEngine,
  type MockShieldedEngine,
} from "../lib/mock-shielded-engine";
import type { ShieldedSync } from "../lib/shielded-engine";
import { PrivacyBadge } from "./privacy-badge";
import { ProofProgress, proofStepStates, useProof } from "./proof-progress";
import { ShieldedAddress, truncateShieldedAddress } from "./shielded-address";
import { ShieldedBalance, useShieldedBalance } from "./shielded-balance";
import { ShieldedProvider, useShieldedAccount, useShieldedEngine } from "./shielded-provider";
import { ShieldedSyncStatus, advanceSync, type ShieldedSyncView } from "./shielded-sync-status";

const weth = { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", decimals: 18 } as const;
const usdc = { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6 } as const;
const recipient = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

type MockOptions = Parameters<typeof createMockShieldedEngine>[0];

/** Unlocked and scanned, with no timers: every engine call finishes when awaited. */
async function unlockedEngine(options: MockOptions = {}) {
  const engine = createMockShieldedEngine({ speed: Infinity, ...options });
  await engine.account.unlock("password");
  await engine.sync(1);
  return engine;
}

/** Real delays under fake timers, unlocked, with the first scan finished. */
async function timedEngine(options: MockOptions = {}) {
  vi.useFakeTimers();
  const engine = createMockShieldedEngine(options);
  void engine.account.unlock("password");
  await vi.advanceTimersByTimeAsync(MOCK_TIMINGS.unlock + MOCK_TIMINGS.firstScan + 100);
  return engine;
}

/** No wagmi provider: the shielded components don't need one. */
function renderShielded(ui: ReactElement, engine: MockShieldedEngine) {
  return render(<ShieldedProvider engine={engine}>{ui}</ShieldedProvider>);
}

const wrapperFor = (engine: MockShieldedEngine) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <ShieldedProvider engine={engine}>{children}</ShieldedProvider>;
  };

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

/** Let work the engine scheduled for "later" run, and React catch up. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve)));

const click = (element: HTMLElement) =>
  act(async () => {
    element.click();
  });

afterEach(() => vi.useRealTimers());

describe("ShieldedProvider", () => {
  it("fails loudly without a provider", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useShieldedEngine())).toThrow("inside <ShieldedProvider>");
    error.mockRestore();
  });

  it("follows the account as it unlocks and locks", async () => {
    const engine = createMockShieldedEngine({ speed: Infinity });
    const { result } = renderHook(() => useShieldedAccount(), { wrapper: wrapperFor(engine) });
    expect(result.current).toEqual({ status: "locked", address: null });

    await act(() => engine.account.unlock("password"));
    expect(result.current.status).toBe("unlocked");
    expect(result.current.address).toHaveLength(127);

    act(() => engine.account.lock());
    expect(result.current).toEqual({ status: "locked", address: null });
  });

  it("keeps the account out of server HTML", async () => {
    const engine = await unlockedEngine();
    function Probe() {
      const { status, address } = useShieldedAccount();
      return <>{`${status}:${address}`}</>;
    }
    const html = renderToString(
      <ShieldedProvider engine={engine}>
        <Probe />
      </ShieldedProvider>
    );
    expect(html).toBe("none:null");
  });
});

describe("ShieldedAddress", () => {
  const address = `0zk1q${"yk9nw8x3ld".repeat(13)}`.slice(0, 127);

  it("shows a truncated address with the full one for screen readers", () => {
    render(<ShieldedAddress address={address} />);
    expect(address).toHaveLength(127);
    expect(screen.getByText(`${address.slice(0, 9)}…${address.slice(-6)}`)).toBeInTheDocument();
    expect(screen.getByText(address)).toHaveClass("sr-only");
    expect(screen.getByTitle(address)).toBeInTheDocument();
  });

  it("copies the full address", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<ShieldedAddress address={address} />);

    await click(screen.getByRole("button", { name: "Copy private address" }));
    expect(writeText).toHaveBeenCalledWith(address);
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
  });

  it("can show the whole address, and hide the copy button", () => {
    render(<ShieldedAddress address={address} truncate={false} copyable={false} />);
    expect(screen.getByText(address)).not.toHaveClass("sr-only");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("truncates to the requested lengths and leaves short strings alone", () => {
    expect(truncateShieldedAddress(address, { start: 5, end: 4 })).toBe(
      `${address.slice(0, 5)}…${address.slice(-4)}`
    );
    expect(truncateShieldedAddress("0zk1short")).toBe("0zk1short");
  });
});

describe("PrivacyBadge", () => {
  it("labels private and public and says what each means", () => {
    render(
      <>
        <PrivacyBadge privacy="private" />
        <PrivacyBadge privacy="public" />
      </>
    );
    const priv = screen.getByText("Private").closest("[data-slot=privacy-badge]")!;
    const pub = screen.getByText("Public").closest("[data-slot=privacy-badge]")!;
    expect(priv).toHaveAttribute("data-privacy", "private");
    expect(priv).toHaveAttribute("title", "Not visible on-chain.");
    expect(pub).toHaveAttribute("data-privacy", "public");
    expect(pub).toHaveAttribute("title", "Visible on-chain to anyone.");
  });

  it("keeps the label for screen readers when it shows only the icon", () => {
    render(<PrivacyBadge privacy="private" iconOnly />);
    expect(screen.getByText("Private")).toHaveClass("sr-only");
  });

  it("takes a custom label and can drop the icon", () => {
    const { container } = render(
      <PrivacyBadge privacy="public" icon={false}>
        Public exit
      </PrivacyBadge>
    );
    expect(screen.getByText("Public exit")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });
});

describe("ShieldedBalance", () => {
  it("renders nothing while the account is locked", () => {
    const engine = createMockShieldedEngine({ speed: Infinity });
    const { container } = renderShielded(<ShieldedBalance token={weth} chainId={1} />, engine);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a skeleton during the first scan, then the spendable amount", async () => {
    const engine = createMockShieldedEngine({
      funds: [{ token: weth.address, amount: parseEther("1.5") }],
    });
    vi.useFakeTimers();
    const { container } = renderShielded(<ShieldedBalance token={weth} chainId={1} />, engine);

    void engine.account.unlock("password");
    await advance(MOCK_TIMINGS.unlock + 1_000);
    const root = container.querySelector("[data-slot=shielded-balance]")!;
    expect(root).toHaveAttribute("data-phase", "loading");
    expect(screen.getByText("Loading private balance")).toBeInTheDocument();

    await advance(MOCK_TIMINGS.firstScan);
    expect(root).toHaveAttribute("data-phase", "ready");
    expect(screen.getByText("1.5")).toBeInTheDocument();
    expect(screen.getByText("WETH")).toBeInTheDocument();
    expect(screen.getByText("Spendable")).toBeInTheDocument();
    // Nothing else is held, so no other state is listed.
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("lists every other state that holds funds, in neutral words", async () => {
    const engine = await unlockedEngine({
      funds: [
        { token: weth.address, amount: parseEther("1") },
        { token: weth.address, amount: parseEther("0.5"), state: "pending" },
        { token: weth.address, amount: parseEther("0.25"), state: "proving" },
        { token: weth.address, amount: parseEther("0.125"), state: "incomplete" },
        { token: weth.address, amount: parseEther("2"), state: "restricted" },
        { token: usdc.address, amount: parseUnits("40", 6) },
      ],
    });
    const { container } = renderShielded(<ShieldedBalance token={weth} chainId={1} />, engine);

    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-state"))).toEqual([
      "pending",
      "proving",
      "incomplete",
      "restricted",
    ]);
    expect(within(rows[0]!).getByText("0.5")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("0.125")).toBeInTheDocument();
    expect(within(rows[3]!).getByText(/only go back to the address they came from/)).toBeInTheDocument();
    // Only the incomplete row has an action.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    // Protocol vocabulary stays in the engine.
    expect(container.textContent).not.toMatch(/POI|innocence|railgun|UTXO/i);
  });

  it("reads a token the account doesn't hold as zero", async () => {
    const engine = await unlockedEngine({ funds: [{ token: weth.address, amount: 1n }] });
    renderShielded(<ShieldedBalance token={usdc} chainId={1} />, engine);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("retries the proofs of incomplete funds and moves them on", async () => {
    const engine = await unlockedEngine({
      funds: [{ token: weth.address, amount: parseEther("0.75"), state: "incomplete" }],
    });
    renderShielded(<ShieldedBalance token={weth} chainId={1} />, engine);
    expect(screen.getByText("Incomplete")).toBeInTheDocument();

    await click(screen.getByRole("button", { name: "Retry proofs" }));
    await settle();

    expect(screen.queryByText("Incomplete")).not.toBeInTheDocument();
    expect(screen.getByText("0.75")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("says so when a retry changes nothing, and shows why when it fails", async () => {
    const engine = await unlockedEngine({
      funds: [{ token: weth.address, amount: 5n, state: "incomplete" }],
    });
    engine.simulate.keepIncomplete();
    renderShielded(<ShieldedBalance token={weth} chainId={1} />, engine);

    await click(screen.getByRole("button", { name: "Retry proofs" }));
    expect(screen.getByText(/Still incomplete/)).toBeInTheDocument();

    engine.simulate.failNextRetry("Proof service unavailable");
    await click(screen.getByRole("button", { name: "Retry proofs" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Proof service unavailable");
    expect(screen.queryByText(/Still incomplete/)).not.toBeInTheDocument();
  });

  it("disables the retry button while a retry runs", async () => {
    const engine = await timedEngine({
      funds: [{ token: weth.address, amount: 5n, state: "incomplete" }],
    });
    renderShielded(<ShieldedBalance token={weth} chainId={1} />, engine);

    await click(screen.getByRole("button", { name: "Retry proofs" }));
    const button = screen.getByRole("button", { name: "Retrying proofs…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("marks itself as updating while a later scan runs, and keeps the amount", async () => {
    const engine = await timedEngine({ funds: [{ token: weth.address, amount: parseEther("2") }] });
    const { container } = renderShielded(<ShieldedBalance token={weth} chainId={1} />, engine);
    const root = container.querySelector("[data-slot=shielded-balance]")!;
    expect(root).not.toHaveAttribute("data-updating");

    void engine.simulate.shield({ token: weth.address, amount: parseEther("1") });
    await advance(MOCK_TIMINGS.repeatScan / 2);
    expect(root).toHaveAttribute("data-updating");
    expect(screen.getByLabelText("Updating")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();

    await advance(MOCK_TIMINGS.repeatScan);
    expect(root).not.toHaveAttribute("data-updating");
    // 1 WETH less the 25 bps fee, waiting out the standby period.
    expect(within(screen.getByRole("listitem")).getByText("0.9975")).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveAttribute("data-state", "pending");
  });

  it("shows a dash when the first scan fails", async () => {
    const engine = createMockShieldedEngine({ speed: Infinity });
    engine.simulate.failNextSync();
    await engine.account.unlock("password");
    await engine.sync(1);
    const { container } = renderShielded(<ShieldedBalance token={weth} chainId={1} />, engine);
    expect(container.querySelector("[data-slot=shielded-balance]")).toHaveAttribute("data-phase", "error");
    expect(screen.getByText("Couldn't load private balance")).toBeInTheDocument();
  });

  it("is only the spendable amount when inline", async () => {
    const engine = await unlockedEngine({
      funds: [
        { token: usdc.address, amount: parseUnits("1234.5", 6) },
        { token: usdc.address, amount: parseUnits("10", 6), state: "pending" },
      ],
    });
    renderShielded(<ShieldedBalance token={usdc} chainId={1} variant="inline" price={1} />, engine);
    expect(screen.getByText("1,234.5")).toBeInTheDocument();
    expect(screen.getByText("$1,234.50")).toBeInTheDocument();
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
  });

  it("exposes amounts as bigint through the hook", async () => {
    const engine = await unlockedEngine({
      funds: [
        { token: weth.address, amount: 3n },
        { token: weth.address, amount: 4n, state: "pending" },
      ],
    });
    function Probe() {
      const { phase, spendable, total, amounts } = useShieldedBalance({
        // Any casing matches.
        token: weth.address.toLowerCase() as `0x${string}`,
        chainId: 1,
      });
      return <>{`${phase} ${typeof spendable} ${spendable} ${total} ${amounts?.pending}`}</>;
    }
    renderShielded(<Probe />, engine);
    expect(screen.getByText("ready bigint 3 7 4")).toBeInTheDocument();
  });
});

describe("advanceSync", () => {
  const syncing = (stage: ShieldedSync["stage"], progress: number): ShieldedSync => ({
    stage,
    status: "syncing",
    progress,
  });

  const run = (states: ShieldedSync[], from?: ShieldedSyncView) => {
    const views: ShieldedSyncView[] = [];
    let view = from;
    for (const state of states) views.push((view = advanceSync(view, state)));
    return views;
  };

  it("never moves backwards within a scan", () => {
    const views = run([
      syncing("notes", 0.5),
      syncing("notes", 0.87),
      syncing("notes", 0.2),
      syncing("notes", 1),
      syncing("transactions", 0),
      syncing("transactions", 0.5),
      { stage: "transactions", status: "synced", progress: 0 },
    ]);
    expect(views.map((view) => view.progress)).toEqual([0.25, 0.435, 0.435, 0.5, 0.5, 0.75, 1]);
    expect(views.at(-1)!.phase).toBe("synced");
  });

  it("starts the next scan from zero", () => {
    const [done] = run([{ stage: "transactions", status: "synced", progress: 0 }]).slice(-1);
    expect(advanceSync(done, syncing("notes", 0.1)).progress).toBeCloseTo(0.05);
  });

  it("keeps the bar where a scan failed, then restarts on retry", () => {
    const views = run([
      syncing("notes", 0.6),
      { stage: "notes", status: "error", progress: 0, error: "RPC down" },
      { stage: "notes", status: "error", progress: 0, error: "RPC down" },
      syncing("notes", 0.1),
    ]);
    expect(views[1]).toEqual({ phase: "error", stage: "notes", progress: 0.3, error: "RPC down" });
    expect(views[2]!.progress).toBe(0.3);
    expect(views[3]).toMatchObject({ phase: "syncing", progress: 0.05 });
  });

  it("clamps progress an engine reports out of range", () => {
    expect(advanceSync(undefined, syncing("transactions", 7)).progress).toBe(1);
    expect(advanceSync(undefined, syncing("notes", -1)).progress).toBe(0);
  });
});

describe("ShieldedSyncStatus", () => {
  const bar = () => Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));

  it("renders nothing until a scan starts", () => {
    const engine = createMockShieldedEngine({ speed: Infinity });
    const { container } = renderShielded(<ShieldedSyncStatus chainId={1} />, engine);
    expect(container).toBeEmptyDOMElement();
  });

  it("names each pass and never moves its bar backwards, though the engine's progress does", async () => {
    vi.useFakeTimers();
    const engine = createMockShieldedEngine();
    const { container } = renderShielded(<ShieldedSyncStatus chainId={1} />, engine);

    const raw: number[] = [];
    engine.subscribe("sync", () => raw.push(engine.getSync(1).progress));
    void engine.account.unlock("password");
    await advance(MOCK_TIMINGS.unlock);

    const shown: number[] = [];
    const labels = new Set<string>();
    while (engine.getSync(1).status === "syncing") {
      shown.push(bar());
      labels.add(screen.getByRole("status").textContent!);
      await advance(500);
    }

    expect(raw.some((progress, i) => i > 0 && progress < raw[i - 1]!)).toBe(true);
    expect(shown.length).toBeGreaterThan(40);
    expect(shown.every((value, i) => i === 0 || value >= shown[i - 1]!)).toBe(true);
    expect(shown.at(-1)).toBeGreaterThan(90);
    expect([...labels]).toEqual(["Finding your funds", "Checking transaction history"]);

    const root = container.querySelector("[data-slot=shielded-sync-status]")!;
    expect(root).toHaveAttribute("data-phase", "synced");
    expect(screen.getByRole("status")).toHaveTextContent("Private balance up to date");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows which step it is on", async () => {
    vi.useFakeTimers();
    const engine = createMockShieldedEngine();
    renderShielded(<ShieldedSyncStatus chainId={1} />, engine);
    void engine.account.unlock("password");
    await advance(MOCK_TIMINGS.unlock + 2_000);
    expect(screen.getByText(/Step 1 of 2/)).toBeInTheDocument();
    await advance(MOCK_TIMINGS.firstScan * 0.85);
    expect(screen.getByText(/Step 2 of 2/)).toBeInTheDocument();
  });

  it("reports a failed scan with the reason and recovers on retry", async () => {
    const engine = createMockShieldedEngine({ speed: Infinity });
    engine.simulate.failNextSync("RPC rate limited");
    await engine.account.unlock("password");
    await engine.sync(1);
    const { container } = renderShielded(<ShieldedSyncStatus chainId={1} />, engine);

    const root = container.querySelector("[data-slot=shielded-sync-status]")!;
    expect(root).toHaveAttribute("data-phase", "error");
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't sync private balance");
    expect(screen.getByRole("alert")).toHaveTextContent("RPC rate limited");

    await click(screen.getByRole("button", { name: "Retry sync" }));
    expect(root).toHaveAttribute("data-phase", "synced");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("calls a later scan an update, and can start one", async () => {
    const engine = await timedEngine();
    renderShielded(<ShieldedSyncStatus chainId={1} />, engine);
    expect(screen.getByRole("status")).toHaveTextContent("Private balance up to date");

    await click(screen.getByRole("button", { name: "Sync again" }));
    expect(screen.getByRole("status")).toHaveTextContent("Updating private balance");
    expect(screen.queryByText(/Step/)).not.toBeInTheDocument();

    await advance(MOCK_TIMINGS.repeatScan + 100);
    expect(screen.getByRole("status")).toHaveTextContent("Private balance up to date");
  });

  it("keeps the last balance in view when an update fails", async () => {
    const engine = await unlockedEngine();
    engine.simulate.failNextSync("RPC rate limited");
    await engine.sync(1);
    renderShielded(<ShieldedSyncStatus chainId={1} />, engine);
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't update private balance");
    expect(screen.getByRole("alert")).toHaveTextContent("last successful sync");
  });

  it("fits on one line when inline", async () => {
    vi.useFakeTimers();
    const engine = createMockShieldedEngine();
    renderShielded(<ShieldedSyncStatus chainId={1} variant="inline" />, engine);
    void engine.account.unlock("password");
    await advance(MOCK_TIMINGS.unlock + 5_000);
    expect(screen.getByRole("status")).toHaveTextContent(/^Finding your funds \d+%$/);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("clears when the account locks", async () => {
    const engine = await unlockedEngine();
    const { container } = renderShielded(<ShieldedSyncStatus chainId={1} />, engine);
    expect(container).not.toBeEmptyDOMElement();
    act(() => engine.account.lock());
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ProofProgress", () => {
  const stepStates = () =>
    screen.getAllByRole("listitem").map((item) => item.getAttribute("data-state"));

  it("works out each step from the phase", () => {
    expect(proofStepStates("idle")).toEqual({
      "loading-circuits": "todo",
      proving: "todo",
      verifying: "todo",
    });
    expect(proofStepStates("proving")).toEqual({
      "loading-circuits": "done",
      proving: "active",
      verifying: "todo",
    });
    expect(proofStepStates("error", "proving")).toMatchObject({ proving: "failed", verifying: "todo" });
    expect(proofStepStates("cancelled", "verifying")).toMatchObject({ proving: "done", verifying: "todo" });
    expect(proofStepStates("done")).toMatchObject({ "loading-circuits": "done", verifying: "done" });
  });

  it("shows stages and a hint for the running one, never a percentage", () => {
    const { container } = render(<ProofProgress phase="loading-circuits">Unshield 0.5 WETH</ProofProgress>);
    expect(container.firstChild).toHaveAttribute("data-phase", "loading-circuits");
    expect(screen.getByRole("status")).toHaveTextContent("Generating proof");
    expect(screen.getByText("Unshield 0.5 WETH")).toBeInTheDocument();
    expect(stepStates()).toEqual(["active", "todo", "todo"]);
    expect(screen.getByText(/first proof downloads the circuit files/)).toBeInTheDocument();
    expect(container.textContent).not.toContain("%");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows the error and offers another try", async () => {
    const onRetry = vi.fn();
    render(<ProofProgress phase="error" stage="proving" error={new Error("Out of memory")} onRetry={onRetry} />);
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't generate proof");
    expect(screen.getByRole("alert")).toHaveTextContent("Out of memory");
    expect(stepStates()).toEqual(["done", "failed", "todo"]);
    await click(screen.getByRole("button", { name: "Try again to generate the proof" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("has no buttons unless it is given handlers", () => {
    render(<ProofProgress phase="proving" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  describe("with useProof", () => {
    const draft = {
      kind: "unshield",
      chainId: 1,
      token: weth.address,
      amount: parseEther("0.5"),
      recipient,
    } as const;
    const funds = [{ token: weth.address, amount: parseEther("1") }];

    function Prover({ onProved, onError }: Parameters<typeof useProof>[0] & {}) {
      const proof = useProof({ onProved, onError });
      return (
        <>
          <button onClick={() => void proof.prove(draft)}>Prove</button>
          <button onClick={proof.reset}>Reset</button>
          <ProofProgress
            phase={proof.phase}
            stage={proof.stage}
            error={proof.error}
            onCancel={proof.cancel}
            onRetry={() => void proof.prove(draft)}
          />
        </>
      );
    }

    const phase = () =>
      document.querySelector("[data-slot=proof-progress]")!.getAttribute("data-phase");

    it("walks through the stages and hands over the proved operation", async () => {
      const engine = await timedEngine({ funds });
      const onProved = vi.fn();
      renderShielded(<Prover onProved={onProved} />, engine);
      expect(phase()).toBe("idle");

      await click(screen.getByRole("button", { name: "Prove" }));
      expect(phase()).toBe("loading-circuits");
      await advance(MOCK_TIMINGS.loadCircuits + 100);
      expect(phase()).toBe("proving");
      expect(stepStates()).toEqual(["done", "active", "todo"]);
      await advance(MOCK_TIMINGS.prove);
      expect(phase()).toBe("verifying");
      await advance(MOCK_TIMINGS.verify);

      expect(phase()).toBe("done");
      expect(screen.getByRole("status")).toHaveTextContent("Proof ready");
      expect(stepStates()).toEqual(["done", "done", "done"]);
      expect(onProved).toHaveBeenCalledWith(expect.objectContaining({ draft }));
      expect(screen.queryByRole("button", { name: "Cancel proof" })).not.toBeInTheDocument();
    });

    it("cancels quietly, marks where it stopped, and can start over", async () => {
      const engine = await timedEngine({ funds });
      const onError = vi.fn();
      renderShielded(<Prover onError={onError} />, engine);

      await click(screen.getByRole("button", { name: "Prove" }));
      await advance(MOCK_TIMINGS.loadCircuits + 100);
      await click(screen.getByRole("button", { name: "Cancel proof" }));

      expect(phase()).toBe("cancelled");
      expect(screen.getByRole("status")).toHaveTextContent("Proof cancelled");
      expect(stepStates()).toEqual(["done", "todo", "todo"]);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(onError).not.toHaveBeenCalled();

      await click(screen.getByRole("button", { name: "Try again to generate the proof" }));
      expect(phase()).toBe("loading-circuits");
    });

    it("reports a failed proof and recovers on retry", async () => {
      const engine = await unlockedEngine({ funds });
      engine.simulate.failNextProof("Out of memory");
      const onError = vi.fn();
      const onProved = vi.fn();
      renderShielded(<Prover onError={onError} onProved={onProved} />, engine);

      await click(screen.getByRole("button", { name: "Prove" }));
      expect(phase()).toBe("error");
      expect(screen.getByRole("alert")).toHaveTextContent("Out of memory");
      expect(stepStates()).toEqual(["done", "failed", "todo"]);
      expect(onError).toHaveBeenCalledOnce();

      await click(screen.getByRole("button", { name: "Try again to generate the proof" }));
      expect(phase()).toBe("done");
      expect(onProved).toHaveBeenCalledOnce();
    });

    it("goes back to idle on reset and ignores the abandoned proof", async () => {
      const engine = await timedEngine({ funds });
      const onProved = vi.fn();
      renderShielded(<Prover onProved={onProved} />, engine);

      await click(screen.getByRole("button", { name: "Prove" }));
      await advance(1_000);
      await click(screen.getByRole("button", { name: "Reset" }));
      expect(phase()).toBe("idle");

      await advance(MOCK_TIMINGS.loadCircuits + MOCK_TIMINGS.prove + MOCK_TIMINGS.verify);
      expect(phase()).toBe("idle");
      expect(onProved).not.toHaveBeenCalled();
    });

    it("aborts the proof when it unmounts", async () => {
      const engine = await timedEngine({ funds });
      const prove = vi.spyOn(engine, "prove");
      const { unmount } = renderShielded(<Prover />, engine);

      await click(screen.getByRole("button", { name: "Prove" }));
      const { signal } = prove.mock.calls[0]![1];
      expect(signal!.aborted).toBe(false);
      unmount();
      expect(signal!.aborted).toBe(true);
    });
  });
});

describe("Agents", () => {
  const agent = createAgent();
  const onPage = () => agent.snapshot().filter((entry) => !entry.offPage && entry.component !== "more");
  const run = (steps: { ref: string; action: string; args?: unknown[] }[]) => act(() => agent.act({ steps }));

  it("names every control apart on one page, and runs the free ones", async () => {
    const engine = await unlockedEngine({
      funds: [{ token: weth.address, amount: parseEther("0.75"), state: "incomplete" }],
    });
    engine.simulate.failNextSync("RPC rate limited");
    await engine.sync(1);
    const onRetry = vi.fn();
    const onCancel = vi.fn();
    renderShielded(
      <>
        <ShieldedSyncStatus chainId={1} />
        <ShieldedBalance token={weth} chainId={1} />
        <ShieldedAddress address={engine.account.address()!} />
        <ProofProgress phase="error" stage="proving" error="Out of memory" onRetry={onRetry} />
        <ProofProgress phase="proving" onCancel={onCancel} />
      </>,
      engine
    );

    const components = onPage();
    for (const e of components) expect(e.label, `${e.component} ${e.ref} has no name`).toBeTruthy();
    const labels = components.map((e) => e.label!);
    for (const label of ["Retry sync", "Retry proofs", "Copy private address", "Cancel proof", "Try again to generate the proof"]) {
      expect(labels, `${label} is missing from the snapshot`).toContain(label);
    }
    expect(collisions(labels)).toEqual([]);

    const result = await run([
      { ref: "Try again to generate the proof", action: "press" },
      { ref: "Cancel proof", action: "press" },
      { ref: "Retry sync", action: "press" },
      { ref: "Retry proofs", action: "press" },
    ]);
    expect(result.ok, result.error?.message).toBe(true);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    await settle();
    expect(screen.queryByText("Incomplete")).not.toBeInTheDocument();
  });
});

/** Pairs of labels where every word of one is in the other, which a step can't tell apart by name. */
function collisions(labels: readonly string[]) {
  const words = (label: string) => new Set(label.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const found: string[] = [];
  labels.forEach((a, i) =>
    labels.forEach((b, j) => {
      const wb = words(b);
      if (i !== j && [...words(a)].every((w) => wb.has(w))) found.push(`${a} / ${b}`);
    })
  );
  return found;
}
