import { act, screen, waitFor, within } from "@testing-library/react";
import {
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { describe, expect, it } from "vitest";
import { useV3Positions } from "@/hooks/use-v3-positions";
import { getSqrtRatioAtTick } from "@/lib/concentrated-liquidity";
import { positionManagerAbi, v3FactoryAbi, v3PoolAbi } from "@/lib/v3-position-manager";
import { connectMock, createTestConfig, renderWithWagmi } from "../../../test/wagmi";
import { PositionList, quoteInToken0, sortPositions } from "./position-list";

const manager = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const factory = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const daiAddress = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const usdcWethPool = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";
const daiWethPool = "0xC2e9F25Be6257c210d7Adf0D4Cd6E3E881ba25f8";

const usdc = { chainId: 1, address: usdcAddress, name: "USD Coin", symbol: "USDC", decimals: 6 } as const;
const eth = { chainId: 1, address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", name: "Ether", symbol: "ETH", decimals: 18 } as const;
const tick = 195770;

// tokenId → [token0, token1, fee, tickLower, tickUpper, liquidity]
const positions: Record<string, [Address, Address, number, number, number, bigint]> = {
  "11": [usdcAddress, weth, 500, tick - 960, tick + 1060, 10n ** 15n],
  "12": [usdcAddress, weth, 500, tick - 1400, tick - 490, 6n * 10n ** 14n],
  "13": [daiAddress, weth, 3000, -82000, -78000, 0n],
};
const fees: Record<string, [bigint, bigint]> = { "11": [5_000_000n, 10n ** 15n], "12": [0n, 0n], "13": [0n, 0n] };

const abis: Record<string, Abi> = {
  [manager.toLowerCase()]: positionManagerAbi,
  [factory.toLowerCase()]: v3FactoryAbi,
  [usdcWethPool.toLowerCase()]: v3PoolAbi,
  [daiWethPool.toLowerCase()]: v3PoolAbi,
  [daiAddress.toLowerCase()]: erc20Abi,
};

function chainRpc({ count = 3n } = {}) {
  return {
    eth_chainId: "0x1",
    eth_blockNumber: "0x64",
    eth_call: call,
  };
  function call([{ to, data }]: [{ to: Address; data: Hex }]) {
      const abi = abis[to.toLowerCase()];
      if (!abi) throw new Error(`no mock for ${to}`);
      const { functionName, args = [] } = decodeFunctionData({ abi, data });
      const a = args as readonly unknown[];
      const result: unknown = (() => {
        switch (functionName) {
          case "balanceOf":
            return count;
          case "tokenOfOwnerByIndex":
            return BigInt(11 + Number(a[1]));
          case "positions": {
            const [t0, t1, fee, lo, hi, liq] = positions[String(a[0])];
            return [0n, zeroAddress, t0, t1, fee, lo, hi, liq, 0n, 0n, 0n, 0n];
          }
          case "collect":
            return fees[String((a[0] as { tokenId: bigint }).tokenId)];
          case "getPool":
            return a[0] === daiAddress ? daiWethPool : usdcWethPool;
          case "slot0":
            return to.toLowerCase() === usdcWethPool.toLowerCase()
              ? [getSqrtRatioAtTick(tick), tick, 0, 0, 0, 0, true]
              : [getSqrtRatioAtTick(-80000), -80000, 0, 0, 0, 0, true];
          case "liquidity":
            return 10n ** 18n;
          case "tickSpacing":
            return to.toLowerCase() === usdcWethPool.toLowerCase() ? 10 : 60;
          case "symbol":
            return "DAI";
          case "name":
            return "Dai Stablecoin";
          case "decimals":
            return 18;
        }
      })();
      return encodeFunctionResult({ abi, functionName, result } as never);
  }
}

function Positions() {
  const { positions, phase } = useV3Positions({ tokens: [usdc], native: eth });
  return (
    <div data-phase={phase}>
      <PositionList positions={positions} locale="en-US" />
    </div>
  );
}

describe("useV3Positions + PositionList", () => {
  it("reads an owner's positions, pools and real fees, and lists them by status", async () => {
    const config = createTestConfig({ rpc: chainRpc() });
    renderWithWagmi(<Positions />, { config });
    expect(screen.getByLabelText("Loading positions")).toBeInTheDocument();
    await act(() => connectMock(config));

    await waitFor(() => expect(document.querySelector("[data-phase]")).toHaveAttribute("data-phase", "ready"), {
      timeout: 10_000,
    });
    expect(screen.getByText("1 in range · 1 out of range · 1 closed")).toBeInTheDocument();

    const cards = [...document.querySelectorAll("[data-slot=position-card]")];
    expect(cards.map((c) => c.getAttribute("data-status"))).toEqual(["in-range", "out-of-range", "closed"]);
    // WETH shows as ETH, quoted in USDC; the stored fees are 0, the simulated ones aren't.
    expect(within(cards[0] as HTMLElement).getByText("ETH / USDC")).toBeInTheDocument();
    await waitFor(() => expect(within(cards[0] as HTMLElement).getByText("5")).toBeInTheDocument());
    // DAI isn't in the list: read on-chain.
    expect(within(cards[2] as HTMLElement).getByText("ETH / DAI")).toBeInTheDocument();
    expect(screen.getByText("Closed positions")).toBeInTheDocument();
    // Six rounds of chained reads: slow on a busy machine.
  }, 15_000);

  it("shows the empty state for an owner without positions", async () => {
    const config = createTestConfig({ rpc: chainRpc({ count: 0n }) });
    renderWithWagmi(<Positions />, { config });
    await act(() => connectMock(config));
    expect(await screen.findByText("No positions yet")).toBeInTheDocument();
  });
});

describe("helpers", () => {
  it("quotes in the stablecoin", () => {
    expect(quoteInToken0({ symbol: "USDC" }, { symbol: "WETH" })).toBe(true);
    expect(quoteInToken0({ symbol: "WETH" }, { symbol: "USDT" })).toBe(false);
    expect(quoteInToken0({ symbol: "USDC" }, { symbol: "USDT" })).toBe(false);
  });

  it("sorts in range first, closed last", () => {
    const pool = { tick: 0, tickSpacing: 10, decimals0: 18, decimals1: 18 };
    const item = (tokenId: bigint, tickLower: number, tickUpper: number, liquidity: bigint) => ({
      position: { tokenId, token0: usdc, token1: eth, tickLower, tickUpper, liquidity },
      pool,
    });
    const sorted = sortPositions([item(1n, -10, 10, 0n), item(2n, 10, 20, 1n), item(3n, -10, 10, 1n)]);
    expect(sorted.map((i) => i.position.tokenId)).toEqual([3n, 2n, 1n]);
  });

  it("renders skeleton cards while loading", () => {
    renderWithWagmi(<PositionList skeletonCount={3} />);
    expect(screen.getAllByText("Loading position")).toHaveLength(3);
  });
});
