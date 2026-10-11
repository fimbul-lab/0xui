import { useQuery } from "@tanstack/react-query";
import { ImageOffIcon } from "lucide-react";
import { useState } from "react";
import { parseAbi, type Address } from "viem";
import { useReadContracts } from "wagmi";
import { resolveUri } from "@/lib/0xui-utils";
import { cn } from "@/lib/utils";

const nftAbi = parseAbi([
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

export { resolveUri };

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

/** Token URI, collection name and metadata for an ERC-721 or ERC-1155 token. */
export function useNft({
  contract,
  tokenId,
  chainId,
  gateway,
}: {
  contract: Address;
  tokenId: bigint;
  chainId?: number;
  gateway?: string;
}) {
  const reads = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: contract, abi: nftAbi, functionName: "tokenURI", args: [tokenId], chainId },
      { address: contract, abi: nftAbi, functionName: "uri", args: [tokenId], chainId },
      { address: contract, abi: nftAbi, functionName: "name", chainId },
    ],
  });
  const [erc721, erc1155, name] = reads.data ?? [];
  const rawUri =
    erc721?.status === "success" ? erc721.result : erc1155?.status === "success" ? erc1155.result : undefined;
  const uri = rawUri ? expandTokenUri(rawUri, tokenId) : undefined;

  const metadata = useQuery({
    queryKey: ["0xui", "nft-metadata", uri, gateway],
    queryFn: () => fetchNftMetadata(uri!, gateway),
    enabled: Boolean(uri),
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });

  const image = metadata.data?.image ?? metadata.data?.image_url;
  return {
    collection: name?.status === "success" ? name.result : undefined,
    metadata: metadata.data,
    image: image ? resolveUri(image, gateway) : undefined,
    isLoading: reads.isLoading || metadata.isLoading,
    /** No token URI: not an NFT contract, or the token doesn't exist. */
    notFound: (reads.isSuccess && !uri) || reads.isError,
    /** The token exists, but its metadata host failed (often a rate-limited IPFS gateway). */
    metadataError: metadata.isError,
  };
}

export type NftCardProps = {
  contract: Address;
  tokenId: bigint;
  chainId?: number;
  /** IPFS gateway with trailing slash. */
  gateway?: string;
  /** Show the token's traits. */
  showAttributes?: boolean;
  className?: string;
};

/**
 * NFT card for an ERC-721 or ERC-1155 token: image, name, collection and
 * token id, from on-chain `tokenURI`/`uri` and its metadata. Handles IPFS,
 * Arweave and inline `data:` metadata, with a skeleton while loading and a
 * placeholder when the image can't load.
 */
export function NftCard({ contract, tokenId, chainId, gateway, showAttributes = false, className }: NftCardProps) {
  const nft = useNft({ contract, tokenId, chainId, gateway });
  const [imageFailed, setImageFailed] = useState(false);
  const title = nft.metadata?.name ?? `#${tokenId}`;
  const phase = nft.isLoading
    ? "loading"
    : nft.notFound
      ? "not-found"
      : nft.metadataError
        ? "metadata-error"
        : "ready";

  return (
    <article
      data-slot="nft-card"
      data-phase={phase}
      aria-busy={phase === "loading" || undefined}
      className={cn("flex w-full max-w-64 flex-col overflow-hidden rounded-2xl border", className)}
    >
      <div className="relative aspect-square bg-muted">
        {phase === "loading" ? (
          <div className="size-full animate-pulse" />
        ) : nft.image && !imageFailed ? (
          <img
            src={nft.image}
            alt={title}
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            <ImageOffIcon aria-hidden className="size-6" />
            {phase === "not-found"
              ? "Token not found"
              : phase === "metadata-error"
                ? "Metadata unavailable"
                : "No image"}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5 p-3">
        {phase === "loading" ? (
          <>
            <span className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <span className="mt-1 h-3 w-1/2 animate-pulse rounded bg-muted" />
          </>
        ) : (
          <>
            <h3 className="truncate text-sm font-semibold">{title}</h3>
            <p className="truncate text-xs text-muted-foreground">
              {nft.collection ?? "Unknown collection"} · #{tokenId.toString()}
            </p>
          </>
        )}
        {showAttributes && nft.metadata?.attributes && nft.metadata.attributes.length > 0 && (
          <dl className="mt-2 flex flex-wrap gap-1.5">
            {nft.metadata.attributes.map((attr, i) => (
              <div key={i} className="rounded-md bg-muted px-2 py-1 text-xs">
                <dt className="text-muted-foreground">{attr.trait_type ?? "Trait"}</dt>
                <dd className="font-medium">{String(attr.value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </article>
  );
}
