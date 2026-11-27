import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { decodeFunctionData, parseAbi, parseEther, parseUnits } from "viem";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  getDependentAmount,
  getSqrtRatioAtTick,
  priceToTick,
  rangeAroundTick,
} from "@/lib/concentrated-liquidity";
import type { PoolState } from "@/lib/concentrated-liquidity";
import {
  connectMock,
  createTestConfig,
  erc20CallRpc,
  fakeChainRpc,
  renderWithWagmi,
  testAccounts,
} from "../../../test/wagmi";
import { AddLiquidity, v3Mint, withSlippage } from "./add-liquidity";
import type { MintRequest } from "./add-liquidity";

const usdc = {
  chainId: 1,
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  name: "USD Coin",
  symbol: "USDC",
  decimals: 6,
} as const;
const eth = {
  chainId: 1,
  address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  name: "Ether",
  symbol: "ETH",
  decimals: 18,
} as const;
const positionManager = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const abi = parseAbi([
  "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function refundETH() payable",
]);

const tick = priceToTick(1 / 3150, 6, 18);
const pool: PoolState = {
  tick,
  sqrtPriceX96: getSqrtRatioAtTick(tick),
  liquidity: 10n ** 18n,
  tickSpacing: 10,
  decimals0: 6,
  decimals1: 18,
};
const range = rangeAroundTick(tick, 10, 10);

const request: MintRequest = {
  token0: usdc,
  token1: eth,
  fee: 500,
  ...range,
  amount0Desired: 3000n * 10n ** 6n,
  amount1Desired: 10n ** 18n,
  amount0Min: withSlippage(3000n * 10n ** 6n, 50),
  amount1Min: withSlippage(10n ** 18n, 50),
  recipient: testAccounts[0],
  deadline: 1_900_000_000n,
};

describe("v3Mint", () => {
  it("wraps native ETH and refunds what's left", () => {
    const tx = v3Mint({ positionManager, weth })(request) as {
      to: string;
      data: Hex;
      value: bigint;
    };
    expect(tx.to).toBe(positionManager);
    expect(tx.value).toBe(10n ** 18n);
    const outer = decodeFunctionData({ abi, data: tx.data });
    expect(outer.functionName).toBe("multicall");
    if (outer.functionName !== "multicall") {
      throw new Error(`Expected a multicall, got ${outer.functionName}`);
    }
    const [mint, refund] = outer.args[0].map((data) => decodeFunctionData({ abi, data }));
    expect(refund).toMatchObject({ functionName: "refundETH" });
    expect(mint).toMatchObject({
      functionName: "mint",
      args: [
        {
          token1: weth,
          fee: 500,
          tickLower: range.tickLower,
          amount0Min: 2985n * 10n ** 6n,
        },
      ],
    });
  });

  it("sends a plain mint for two ERC-20s", () => {
    const tx = v3Mint({ positionManager })({
      ...request,
      token1: { ...eth, address: weth, symbol: "WETH" },
    });
    expect((tx as { value?: bigint }).value).toBeUndefined();
    expect(decodeFunctionData({ abi, data: (tx as { data: Hex }).data }).functionName).toBe("mint");
  });

  it("refuses tokens out of pool order", () => {
    expect(() =>
      v3Mint({ positionManager, weth })({ ...request, token0: eth, token1: usdc }),
    ).toThrow(/pool order/);
  });
});

function setup({ usdcBalance = parseUnits("100000", 6), ethBalance = parseEther("10") } = {}) {
  const sent: Array<{ to: string; data: Hex; value?: Hex }> = [];
  const chain = fakeChainRpc();
  const config = createTestConfig({
    rpc: {
      ...chain,
      eth_getBalance: `0x${ethBalance.toString(16)}`,
      eth_call: erc20CallRpc({
        balance: usdcBalance,
        allowance: 2n ** 255n,
        decimals: 6,
        symbol: "USDC",
      }),
      eth_sendTransaction: (params: [{ to: string; data: Hex; value?: Hex }]) => {
        sent.push(params[0]);
        return (chain.eth_sendTransaction as (p: unknown) => unknown)(params);
      },
    },
  });
  return { config, sent };
}

describe("AddLiquidity", () => {
  it("fills the other amount at the range's ratio and mints", async () => {
    const { config, sent } = setup();
    renderWithWagmi(
      <AddLiquidity
        token0={usdc}
        token1={eth}
        pool={pool}
        fee={500}
        getTransaction={v3Mint({ positionManager, weth })}
        spender={positionManager}
        defaultInvert
      />,
      { config },
    );
    await act(() => connectMock(config));

    await userEvent.type(screen.getByLabelText("ETH"), "1");
    // Inverted, the default ±10% is symmetric in USDC per ETH.
    const shown = rangeAroundTick(tick, 10, 10, { invert: true });
    const expected = getDependentAmount({
      sqrtPriceX96: pool.sqrtPriceX96!,
      ...shown,
      amount: 10n ** 18n,
      token: "token1",
    })!;
    expect(screen.getByLabelText("USDC")).toHaveValue(String(Number(expected) / 1e6));

    const button = await screen.findByRole("button", { name: "Add liquidity" });
    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveAttribute(
      "data-agent-confirm",
      expect.stringMatching(
        /^Deposits \d+\.\d+ USDC and 1 ETH from your wallet as liquidity between .+ and .+ USDC per ETH/,
      ),
    );
    await userEvent.click(button);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.to.toLowerCase()).toBe(positionManager.toLowerCase());
    expect(BigInt(sent[0]!.value!)).toBe(10n ** 18n);
  });

  it("locks the side a single-sided range doesn't take", async () => {
    const { config } = setup();
    renderWithWagmi(
      <AddLiquidity
        token0={usdc}
        token1={eth}
        pool={pool}
        fee={500}
        defaultRange={{ tickLower: tick - 1400, tickUpper: tick - 490 }}
        getTransaction={v3Mint({ positionManager, weth })}
        spender={positionManager}
      />,
      { config },
    );
    expect(screen.queryByLabelText("USDC")).not.toBeInTheDocument();
    expect(screen.getByText(/No USDC needed/)).toBeInTheDocument();
    expect(document.querySelector("[data-slot=add-liquidity]")).toHaveAttribute(
      "data-deposit-mode",
      "token1",
    );
  });

  it("names a short balance on the computed side", async () => {
    const { config } = setup({ usdcBalance: parseUnits("10", 6) });
    renderWithWagmi(
      <AddLiquidity
        token0={usdc}
        token1={eth}
        pool={pool}
        fee={500}
        getTransaction={v3Mint({ positionManager, weth })}
        spender={positionManager}
      />,
      { config },
    );
    await act(() => connectMock(config));
    await userEvent.type(screen.getByLabelText("ETH"), "1");
    expect(await screen.findByRole("button", { name: "Insufficient USDC balance" })).toBeDisabled();
  });
});
