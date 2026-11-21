import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { decodeFunctionData, zeroAddress, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { getPositionAmounts, getSqrtRatioAtTick } from "@/lib/concentrated-liquidity";
import { positionManagerAbi, v3Collect, v3Remove, withSlippage } from "@/lib/v3-position-manager";
import {
  connectMock,
  createTestConfig,
  fakeChainRpc,
  renderWithWagmi,
  testAccounts,
} from "../../../test/wagmi";
import { PositionCard } from "./position-card";
import { RemoveLiquidity, getRemoveAmounts } from "./remove-liquidity";
import { SlippageInput } from "./slippage-input";

const usdc = { chainId: 1, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", name: "USD Coin", symbol: "USDC", decimals: 6 } as const;
const eth = { chainId: 1, address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", name: "Ether", symbol: "ETH", decimals: 18 } as const;
const dai = { chainId: 1, address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", name: "Dai", symbol: "DAI", decimals: 18 } as const;
const positionManager = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const me = testAccounts[0];

const tick = 195770;
const pool = { tick, sqrtPriceX96: getSqrtRatioAtTick(tick), tickSpacing: 10, decimals0: 6, decimals1: 18 };
const position = {
  tokenId: 7n,
  token0: usdc,
  token1: eth,
  fee: 500,
  tickLower: tick - 960,
  tickUpper: tick + 1060,
  liquidity: 10n ** 15n,
  fees0: 18_420_000n,
  fees1: 5_700_000_000_000_000n,
};

const decode = (data: Hex) => decodeFunctionData({ abi: positionManagerAbi, data });
const inner = (data: Hex) => (decode(data).args as unknown as [Hex[]])[0].map(decode);

describe("v3Remove", () => {
  it("decreases and collects, unwrapping native ETH", () => {
    const tx = v3Remove({ positionManager, weth })({
      tokenId: 7n,
      token0: usdc,
      token1: eth,
      liquidity: 5n,
      amount0Min: 1n,
      amount1Min: 2n,
      recipient: me,
      deadline: 99n,
    });
    const [decrease, collect, unwrap, sweep] = inner(tx.data);
    expect(decrease.functionName).toBe("decreaseLiquidity");
    expect((decrease.args as unknown as [{ liquidity: bigint }])[0].liquidity).toBe(5n);
    expect(collect.functionName).toBe("collect");
    // Collected into the manager, so it can unwrap.
    expect((collect.args as unknown as [{ recipient: string }])[0].recipient).toBe(zeroAddress);
    expect(unwrap.functionName).toBe("unwrapWETH9");
    expect(unwrap.args).toEqual([2n, me]);
    expect(sweep.functionName).toBe("sweepToken");
    expect(sweep.args).toEqual([usdc.address, 1n, me]);
  });

  it("collects straight to the user for two ERC-20s", () => {
    const tx = v3Collect({ positionManager })({ tokenId: 7n, token0: dai, token1: usdc, recipient: me });
    const call = decode(tx.data);
    expect(call.functionName).toBe("collect");
    expect((call.args as unknown as [{ recipient: string }])[0].recipient).toBe(me);
  });
});

describe("getRemoveAmounts", () => {
  it("removes a share of the liquidity and keeps all fees", () => {
    const half = getRemoveAmounts(position, pool, 50, 50);
    const all = getPositionAmounts(position, pool);
    expect(half.liquidity).toBe(position.liquidity / 2n);
    expect(Number(half.amount0) / Number(all.amount0)).toBeCloseTo(0.5, 6);
    expect(half.amount1Min).toBe(withSlippage(half.amount1, 50));
    expect(half.fees0).toBe(position.fees0);
  });
});

describe("SlippageInput", () => {
  function Harness({ initial = 50 }: { initial?: number }) {
    const [bps, setBps] = useState(initial);
    return (
      <>
        <SlippageInput value={bps} onValueChange={setBps} />
        <output>{bps}</output>
      </>
    );
  }

  it("takes presets and custom percents in basis points", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "1%" }));
    expect(document.querySelector("output")).toHaveTextContent("100");
    await userEvent.type(screen.getByLabelText(/Custom slippage/), "0.3");
    expect(document.querySelector("output")).toHaveTextContent("30");
  });

  it("warns about sandwich risk and refuses nonsense", async () => {
    render(<Harness initial={800} />);
    expect(screen.getByText(/bot could trade ahead/)).toBeInTheDocument();
    expect(document.querySelector("[data-slot=slippage-input]")).toHaveAttribute("data-warning", "high");
    const custom = screen.getByLabelText(/Custom slippage/);
    await userEvent.clear(custom);
    await userEvent.type(custom, "abc");
    expect(custom).toHaveValue("");
  });
});

describe("PositionCard", () => {
  it("shows holdings and fees, and collects", async () => {
    const sent: { to: string; data: Hex }[] = [];
    const chain = fakeChainRpc();
    const config = createTestConfig({
      rpc: {
        ...chain,
        eth_sendTransaction: (params: [{ to: string; data: Hex }]) => {
          sent.push(params[0]);
          return (chain.eth_sendTransaction as (p: unknown) => unknown)(params);
        },
      },
    });
    renderWithWagmi(
      <PositionCard
        position={position}
        pool={pool}
        prices={{ USDC: 1, ETH: 3150 }}
        invert
        getCollectTransaction={v3Collect({ positionManager, weth })}
        locale="en-US"
      />,
      { config }
    );
    await act(() => connectMock(config));
    expect(screen.getByText("ETH / USDC")).toBeInTheDocument();
    expect(screen.getByText("In range")).toBeInTheDocument();
    expect(screen.getByText("Unclaimed fees")).toBeInTheDocument();
    // 18.42 USDC + 0.0057 ETH at 3,150.
    expect(screen.getByText("$36.38")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Collect fees" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(inner(sent[0].data).map((c) => c.functionName)).toEqual(["collect", "unwrapWETH9", "sweepToken"]);
  });

  it("names why there is nothing to collect", async () => {
    const config = createTestConfig({ rpc: fakeChainRpc() });
    renderWithWagmi(
      <PositionCard
        position={{ ...position, liquidity: 0n, fees0: 0n, fees1: 0n }}
        pool={pool}
        getCollectTransaction={v3Collect({ positionManager, weth })}
      />,
      { config }
    );
    await act(() => connectMock(config));
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "No fees to collect" })).toBeDisabled();
  });
});

describe("RemoveLiquidity", () => {
  it("removes the picked share in one transaction", async () => {
    const sent: { data: Hex }[] = [];
    const chain = fakeChainRpc();
    const config = createTestConfig({
      rpc: {
        ...chain,
        eth_sendTransaction: (params: [{ data: Hex }]) => {
          sent.push(params[0]);
          return (chain.eth_sendTransaction as (p: unknown) => unknown)(params);
        },
      },
    });
    renderWithWagmi(
      <RemoveLiquidity position={position} pool={pool} getTransaction={v3Remove({ positionManager, weth })} />,
      { config }
    );
    await act(() => connectMock(config));
    await userEvent.click(screen.getByRole("button", { name: "Max" }));
    const button = screen.getByRole("button", { name: "Remove all liquidity" });
    await userEvent.click(button);
    await waitFor(() => expect(sent).toHaveLength(1));
    const [decrease] = inner(sent[0].data);
    expect((decrease.args as unknown as [{ liquidity: bigint }])[0].liquidity).toBe(position.liquidity);
  });

  it("blocks a closed position", async () => {
    const config = createTestConfig({ rpc: fakeChainRpc() });
    renderWithWagmi(
      <RemoveLiquidity position={{ ...position, liquidity: 0n }} pool={pool} getTransaction={v3Remove({ positionManager, weth })} />,
      { config }
    );
    await act(() => connectMock(config));
    expect(await screen.findByRole("button", { name: "Position is closed" })).toBeDisabled();
  });
});
