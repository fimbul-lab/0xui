// Docs: https://0xui.io/components/nft-card.md
import { useQuery } from "@tanstack/react-query";
import { ImageOffIcon } from "lucide-react";
import { useState } from "react";
import { Skeleton } from "skullet/react";
import type { Address } from "viem";
import { useConfig } from "wagmi";
import {
  nftImage,
  nftMetadataQueryOptions,
  nftPhase,
  nftTokenQueryOptions,
} from "@/lib/nft-card-core";
import { cn } from "@/lib/utils";

export { resolveUri } from "@/lib/0xui-utils";
export {
  expandTokenUri,
  fetchNftMetadata,
  nftMetadataQueryOptions,
  nftTokenQueryOptions,
  type NftMetadata,
  type NftPhase,
} from "@/lib/nft-card-core";

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
  const config = useConfig();
  const token = useQuery(nftTokenQueryOptions(config, { contract, tokenId, chainId }));
  const uri = token.data?.uri;
  const metadata = useQuery(nftMetadataQueryOptions({ uri, gateway }));

  return {
    collection: token.data?.collection,
    metadata: metadata.data,
    image: nftImage(metadata.data, gateway),
    isLoading: token.isLoading || metadata.isLoading,
    /** No token URI: not an NFT contract, or the token doesn't exist. */
    notFound: (token.isSuccess && !uri) || token.isError,
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
export function NftCard({
  contract,
  tokenId,
  chainId,
  gateway,
  showAttributes = false,
  className,
}: NftCardProps) {
  const nft = useNft({ contract, tokenId, chainId, gateway });
  const [imageFailed, setImageFailed] = useState(false);
  const title = nft.metadata?.name ?? `#${tokenId}`;
  const phase = nftPhase(nft);

  return (
    <article
      data-slot="nft-card"
      data-phase={phase}
      className={cn("w-full max-w-64 overflow-hidden rounded-2xl border", className)}
    >
      {/* While loading, the card is laid out with stand-in text and measured into a skeleton. */}
      <Skeleton loading={phase === "loading"} label="Loading NFT">
        <div className="relative aspect-square bg-muted">
          {phase === "loading" ? (
            // One block for the image, not a bar per element.
            <div skullet-block="" className="size-full" />
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
          <h3 className="truncate text-sm font-semibold">
            {phase === "loading" ? "Sample token name" : title}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {phase === "loading" ? "Sample collection" : (nft.collection ?? "Unknown collection")} ·
            #{tokenId.toString()}
          </p>
          {showAttributes && nft.metadata?.attributes && nft.metadata.attributes.length > 0 && (
            <dl className="mt-2 flex flex-wrap gap-1.5">
              {nft.metadata.attributes.map((attr, i) => (
                // Metadata may repeat a trait type, so position is the only stable key.
                <div key={i} className="rounded-md bg-muted px-2 py-1 text-xs">
                  <dt className="text-muted-foreground">{attr.trait_type ?? "Trait"}</dt>
                  <dd className="font-medium">{String(attr.value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </Skeleton>
    </article>
  );
}
