// Docs: https://0xui.io/components/block-number.md
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { SkeletonBox } from "skullet/react";
import { useChainId, useConfig } from "wagmi";
import { ExplorerLink } from "@/components/explorer-link";
import { MorphText } from "@/components/morph-text";
import {
  blockNumberPhase,
  blockNumberQueryOptions,
  formatBlockNumber,
  watchBlockNumberQuery,
} from "@/lib/block-number-core";
import { cn } from "@/lib/utils";

export type { BlockNumberPhase } from "@/lib/block-number-core";

/** SkeletonBox is a block by default. This one sits in a line of text. */
const inlineBox = { display: "inline-block", verticalAlign: "middle" } as const;

export type BlockNumberProps = {
  /** Chain to watch. Defaults to the current chain. */
  chainId?: number;
  /** Keep updating as new blocks arrive. */
  watch?: boolean;
  /** Link the number to the block on the explorer. */
  explorer?: boolean;
  className?: string;
};

/** Latest block number and whether the RPC is reachable. */
export function useLiveBlockNumber({
  chainId,
  watch = true,
}: Pick<BlockNumberProps, "chainId" | "watch"> = {}) {
  const config = useConfig();
  const queryClient = useQueryClient();
  const currentChainId = useChainId();
  const id = chainId ?? currentChainId;
  const query = useQuery(blockNumberQueryOptions(config, { chainId: id }));

  useEffect(() => {
    if (watch) return watchBlockNumberQuery(config, queryClient, { chainId: id });
  }, [config, queryClient, id, watch]);

  return { blockNumber: query.data, phase: blockNumberPhase(query) };
}

/**
 * Live block indicator: a status dot plus the latest block number. Doubles
 * as an RPC health check. The dot turns red when the RPC fails.
 */
export function BlockNumber({
  chainId,
  watch = true,
  explorer = false,
  className,
}: BlockNumberProps) {
  const { blockNumber, phase } = useLiveBlockNumber({ chainId, watch });
  const formatted = blockNumber === undefined ? undefined : formatBlockNumber(blockNumber);

  return (
    <span
      data-slot="block-number"
      data-phase={phase}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          phase === "live" && "bg-emerald-500",
          phase === "live" && watch && "animate-pulse motion-reduce:animate-none",
          phase === "loading" && "bg-muted-foreground/40",
          phase === "error" && "bg-destructive",
        )}
      />
      {phase === "error" ? (
        <span>RPC unavailable</span>
      ) : formatted === undefined ? (
        <span>
          {/* About the width of "21,000,000". */}
          <SkeletonBox width="10ch" height="1em" style={inlineBox} />
          <span className="sr-only">Loading block…</span>
        </span>
      ) : explorer ? (
        <ExplorerLink block={blockNumber!} chainId={chainId} icon={false}>
          <span className="sr-only">Block </span>
          <MorphText>{formatted}</MorphText>
        </ExplorerLink>
      ) : (
        <span>
          <span className="sr-only">Block </span>
          <MorphText>{formatted}</MorphText>
        </span>
      )}
    </span>
  );
}
