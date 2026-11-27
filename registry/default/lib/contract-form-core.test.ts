import { parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { createTestConfig, erc20CallRpc, testAccounts } from "../../../test/wagmi";
import {
  contractFunctions,
  functionCallDraft,
  functionConfirmText,
  functionKind,
  functionSignature,
  initialFunctionValues,
  readFunctionMutationOptions,
} from "./contract-form-core";

const abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function deposit() payable",
  "function setFlag(bool on)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const [balanceOf, transfer, deposit, setFlag] = contractFunctions(abi);

describe("contract-form", () => {
  it("lists functions, filtered and in the asked order", () => {
    expect(contractFunctions(abi).map((fn) => fn.name)).toEqual([
      "balanceOf",
      "transfer",
      "deposit",
      "setFlag",
    ]);
    expect(contractFunctions(abi, { show: "read" }).map((fn) => fn.name)).toEqual(["balanceOf"]);
    expect(
      contractFunctions(abi, { functions: ["transfer", "balanceOf"] }).map((fn) => fn.name),
    ).toEqual(["transfer", "balanceOf"]);
    expect(functionSignature(transfer!)).toBe("transfer(address, uint256)");
    expect([balanceOf, transfer, deposit].map((fn) => functionKind(fn!))).toEqual([
      "read",
      "write",
      "payable",
    ]);
    expect(initialFunctionValues(setFlag!)).toEqual(["false"]);
  });

  it("names the first field to fix", () => {
    expect(functionCallDraft(transfer!, ["", ""]).blocker).toBe("Check to");
    expect(functionCallDraft(transfer!, [testAccounts[1], "x"]).blocker).toBe("Check amount");
    expect(functionCallDraft(transfer!, [testAccounts[1], "10"])).toMatchObject({
      args: [testAccounts[1], 10n],
      blocker: undefined,
    });
  });

  it("parses the ETH value of payable calls", () => {
    expect(functionCallDraft(deposit!, [], "0.5").value).toBe(500_000_000_000_000_000n);
    expect(functionCallDraft(deposit!, [], "").value).toBeUndefined();
    expect(functionCallDraft(deposit!, [], "abc")).toMatchObject({
      value: null,
      blocker: "Check the ETH value",
    });
  });

  it("reads a view function", async () => {
    const config = createTestConfig({ rpc: { eth_call: erc20CallRpc({ balance: 42n }) } });
    const options = readFunctionMutationOptions(config, {
      address: testAccounts[0],
      fn: balanceOf!,
      chainId: 1,
    });
    expect(await options.mutationFn([testAccounts[1]])).toBe(42n);
  });
});

describe("functionConfirmText", () => {
  const contract = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const [, transfer] = contractFunctions(abi);

  it("names the function with every argument, the contract and the network", () => {
    const draft = functionCallDraft(transfer!, [testAccounts[0], "10"]);
    expect(
      functionConfirmText(transfer!, draft, { address: contract, chainName: "Ethereum" }),
    ).toBe(
      `Calls transfer(to: ${testAccounts[0]}, amount: 10) on contract ${contract} on Ethereum, from your wallet`,
    );
  });

  it("names unnamed arguments by position, nested ones as JSON, and the ETH sent", () => {
    const [deposit] = contractFunctions(
      parseAbi(["function deposit(uint256[] ids, (address to, uint256 amount), bool) payable"]),
    );
    const draft = functionCallDraft(
      deposit!,
      ['["1", 2]', `{ "to": "${testAccounts[0]}", "amount": "5" }`, "true"],
      "0.5",
    );
    expect(functionConfirmText(deposit!, draft, { address: contract, nativeSymbol: "POL" })).toBe(
      `Calls deposit(ids: ["1","2"], arg1: {"to":"${testAccounts[0]}","amount":"5"}, arg2: true) ` +
        `on contract ${contract} and sends 0.5 POL, from your wallet`,
    );
  });
});
