import type { Config } from "@wagmi/core";
import { hashFn, readContractsQueryOptions } from "@wagmi/core/query";
import { parseAbi, type Address } from "viem";
import { resolveUri } from "@/lib/0xui-utils";

export const nftAbi = parseAbi([
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function uri(uint256 id) view returns (string)",
  "function name() view returns (string)",
]);

export type NftMetadata = {
  name?: string;
  description?: string;
  image?: string;
  image_url?: string;
  attributes?: { trait_type?: string; value?: unknown }[];
};

/** ERC-1155 URIs may contain `{id}`: the token id as 64 lowercase hex characters. */
export function expandTokenUri(uri: string, tokenId: bigint) {
  return uri.replace("{id}", tokenId.toString(16).padStart(64, "0"));
}

/**
 * Read token metadata from an HTTP, IPFS, Arweave or inline `data:` URI.
 * `fetch` decodes `data:` URIs (base64 or not) on its own.
 */
export async function fetchNftMetadata(uri: string, gateway?: string): Promise<NftMetadata> {
  const response = await fetch(resolveUri(uri, gateway));
  if (!response.ok) throw new Error(`Metadata request failed (${response.status})`);
  return response.json();
}

export type NftToken = {
  /** Token URI with `{id}` expanded, or undefined when neither `tokenURI` nor `uri` answered. */
  uri: string | undefined;
  /** The contract's `name()`. */
  collection: string | undefined;
};

/**
 * TanStack query options for a token's URI (ERC-721 `tokenURI` or ERC-1155
 * `uri`) and its collection name, read in one batch.
 */
export function nftTokenQueryOptions(
  config: Config,
  { contract, tokenId, chainId }: { contract: Address; tokenId: bigint; chainId?: number },
) {
  const options = readContractsQueryOptions(config, {
    allowFailure: true,
    contracts: [
      { address: contract, abi: nftAbi, functionName: "tokenURI", args: [tokenId], chainId },
      { address: contract, abi: nftAbi, functionName: "uri", args: [tokenId], chainId },
      { address: contract, abi: nftAbi, functionName: "name", chainId },
    ],
  });
  return {
    ...options,
    // The key holds the token id, a bigint the default hash can't serialize.
    queryKeyHashFn: hashFn,
    select: ([erc721, erc1155, name]: Awaited<ReturnType<typeof options.queryFn>>): NftToken => {
      const raw =
        erc721?.status === "success" ? erc721.result : erc1155?.status === "success" ? erc1155.result : undefined;
      return {
        uri: raw ? expandTokenUri(raw, tokenId) : undefined,
        collection: name?.status === "success" ? name.result : undefined,
      };
    },
  };
}

/** TanStack query options for a token's metadata JSON. Retries once: IPFS gateways rate-limit. */
export function nftMetadataQueryOptions({ uri, gateway }: { uri: string | undefined; gateway?: string }) {
  return {
    queryKey: ["0xui", "nft-metadata", uri, gateway] as const,
    queryFn: () => fetchNftMetadata(uri!, gateway),
    enabled: Boolean(uri),
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  };
}

/** The metadata's image, resolved to an HTTP URL. */
export function nftImage(metadata: NftMetadata | undefined, gateway?: string) {
  const image = metadata?.image ?? metadata?.image_url;
  return image ? resolveUri(image, gateway) : undefined;
}

export type NftPhase = "loading" | "not-found" | "metadata-error" | "ready";

export function nftPhase({
  isLoading,
  notFound,
  metadataError,
}: {
  isLoading: boolean;
  notFound: boolean;
  metadataError: boolean;
}): NftPhase {
  if (isLoading) return "loading";
  if (notFound) return "not-found";
  if (metadataError) return "metadata-error";
  return "ready";
}
