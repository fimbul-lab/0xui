import { encodeFunctionResult } from "viem";
import { describe, expect, it } from "vitest";
import { createTestConfig } from "../../../test/wagmi";
import { nftAbi, nftImage, nftMetadataQueryOptions, nftPhase, nftTokenQueryOptions } from "./nft-card-core";

const contract = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D";

async function readToken(config: ReturnType<typeof createTestConfig>, tokenId: bigint) {
  const options = nftTokenQueryOptions(config, { contract, tokenId, chainId: 1 });
  const results = await options.queryFn({ queryKey: options.queryKey } as never);
  return options.select(results);
}

describe("nft-card", () => {
  it("reads an ERC-1155 uri and expands its {id}", async () => {
    const config = createTestConfig({
      rpc: {
        eth_call: ([{ data }]: [{ data: string }]) => {
          if (data.startsWith("0x0e89341c"))
            return encodeFunctionResult({ abi: nftAbi, functionName: "uri", result: "ipfs://Qm/{id}.json" });
          if (data.startsWith("0x06fdde03"))
            return encodeFunctionResult({ abi: nftAbi, functionName: "name", result: "Items" });
          throw new Error("execution reverted");
        },
      },
    });
    expect(await readToken(config, 255n)).toEqual({
      uri: `ipfs://Qm/${"0".repeat(62)}ff.json`,
      collection: "Items",
    });
  });

  it("finds no URI on a contract that isn't an NFT", async () => {
    const config = createTestConfig({
      rpc: {
        eth_call: () => {
          throw new Error("execution reverted");
        },
      },
    });
    expect(await readToken(config, 1n)).toEqual({ uri: undefined, collection: undefined });
  });

  it("fetches metadata and resolves its image", async () => {
    const uri = `data:application/json,${JSON.stringify({ name: "Ape", image: "ar://img" })}`;
    const metadata = await nftMetadataQueryOptions({ uri }).queryFn();
    expect(metadata.name).toBe("Ape");
    expect(nftImage(metadata)).toBe("https://arweave.net/img");
    expect(nftMetadataQueryOptions({ uri: undefined }).enabled).toBe(false);
  });

  it("orders phases", () => {
    expect(nftPhase({ isLoading: true, notFound: true, metadataError: true })).toBe("loading");
    expect(nftPhase({ isLoading: false, notFound: true, metadataError: true })).toBe("not-found");
    expect(nftPhase({ isLoading: false, notFound: false, metadataError: true })).toBe("metadata-error");
    expect(nftPhase({ isLoading: false, notFound: false, metadataError: false })).toBe("ready");
  });
});
