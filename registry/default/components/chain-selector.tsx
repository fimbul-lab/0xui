// Docs: https://0xui.io/components/chain-selector.md
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/primitives/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/primitives/dialog";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/primitives/tabs";
import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import { cn } from "@/lib/utils";
import { CheckIcon, ChevronDownIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { SkeletonBox } from "skullet/react";
import { type Chain } from "viem";
import { useConfig } from "wagmi";
import { ChainIcon, type ChainIconProps } from "@/components/chain-badge";
import { MorphText } from "@/components/morph-text";
import { useMounted } from "@/hooks/use-mounted";
import { useStore } from "@/hooks/use-store";
import { createChainSwitcher } from "@/lib/chain-switcher";

type IconStyleProps =
  | {
      /** Icon style. */
      variant: "mono";
      /** Color for mono variant icons. Only applies when variant is "mono". */
      monoColor?: string;
    }
  | {
      /** Icon style. */
      variant?: "branded" | "background";
      monoColor?: never;
    };

export type { ChainIconProps };

export type ChainSelectorProps = {
  /** Custom chain icon component. Receives chainId, className, and variant props. Pass false to hide. */
  chainIcon?: ComponentType<ChainIconProps> | false;
  /** Custom chevron icon component. Receives className prop. Pass false to hide. */
  chevronIcon?: ComponentType<{ className?: string }> | false;
  /** Custom loader icon component. Receives className prop. Pass false to hide. */
  loaderIcon?: ComponentType<{ className?: string }> | false;
  /** Disable all icons. Overrides individual icon props. */
  disableIcons?: boolean;
  /** Show only icons without visible labels. Label remains accessible via tooltip and screen readers. */
  iconOnly?: boolean;
  /** Group chains by network type (mainnet/testnet) with tabs. */
  groupByNetwork?: boolean;
  /** Extra detail under each chain's name, e.g. bridge time or fees. */
  chainMeta?: (chain: Chain) => ReactNode;
} & IconStyleProps;

function groupChainsByNetwork(chains: readonly Chain[]) {
  const mainnet: Chain[] = [];
  const testnet: Chain[] = [];

  chains.forEach((chain) => {
    if ((chain as Chain & { testnet?: boolean }).testnet) {
      testnet.push(chain);
    } else {
      mainnet.push(chain);
    }
  });

  return { mainnet, testnet };
}

/**
 * The chain switcher for the app's wagmi config, as React state. The logic
 * lives in `createChainSwitcher` (framework-free); this only renders it.
 */
export function useChainSwitcher() {
  const config = useConfig();
  const switcher = useMemo(() => createChainSwitcher(config), [config]);
  const state = useStore(switcher);
  const [open, setOpen] = useState(false);
  const mounted = useMounted();

  const onSwitch = async (id: number) => {
    if (await switcher.switchTo(id)) setOpen(false);
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) switcher.reset();
  };

  return {
    ...state,
    open,
    onOpenChange,
    mounted,
    onSwitch,
    isPending: state.pendingChainId !== undefined,
    unsupported: mounted && state.unsupported,
  };
}

function resolveIcons({
  chainIcon,
  chevronIcon,
  loaderIcon,
  disableIcons,
}: Pick<ChainSelectorProps, "chainIcon" | "chevronIcon" | "loaderIcon" | "disableIcons">) {
  if (disableIcons) return {};
  return {
    ChainIcon: chainIcon === false ? undefined : chainIcon || ChainIcon,
    ChevronIcon: chevronIcon === false ? undefined : chevronIcon || ChevronDownIcon,
    LoaderIcon: loaderIcon === false ? undefined : loaderIcon || Loader2Icon,
  };
}

function chainIconProps(
  chainId: number,
  variant: "branded" | "mono" | "background",
  monoColor: string | undefined,
  className?: string,
): ChainIconProps {
  return { chainId, variant, monoColor, className };
}

const triggerClassName = ({
  iconOnly,
  unsupported,
  ChainIcon,
  ChevronIcon,
}: {
  iconOnly?: boolean;
  unsupported?: boolean;
  ChainIcon?: unknown;
  ChevronIcon?: unknown;
}) =>
  cn(
    "flex items-center gap-2 justify-between border transition-all w-fit py-2 px-3 rounded-full hover:bg-accent/10 active:scale-97 cursor-pointer",
    iconOnly ? "min-w-fit gap-1 p-1" : "min-w-30",
    // Bare text needs more room on the pill's curve than an icon does.
    !iconOnly && !ChainIcon && !unsupported && "pl-4",
    !iconOnly && !ChevronIcon && "pr-4",
    unsupported && "border-destructive/50 text-destructive",
  );

function TriggerContent({
  mounted,
  unsupported,
  currentChain,
  chainName,
  iconOnly,
  open,
  isPending,
  variant,
  monoColor,
  ChainIcon,
  ChevronIcon,
  LoaderIcon,
}: {
  mounted: boolean;
  unsupported: boolean;
  currentChain: Chain | undefined;
  chainName: string;
  iconOnly?: boolean;
  open: boolean;
  isPending: boolean;
  variant: "branded" | "mono" | "background";
  monoColor?: string;
  ChainIcon?: ComponentType<ChainIconProps>;
  ChevronIcon?: ComponentType<{ className?: string }>;
  LoaderIcon?: ComponentType<{ className?: string }>;
}) {
  return (
    <>
      {/* Names the trigger "Network: <chain>" for screen readers and agents. */}
      <span className="sr-only">Network: </span>
      {unsupported && <TriangleAlertIcon aria-hidden className="size-5 shrink-0" />}
      {/* Before mount the chain isn't known: a skeleton in the trigger's own
          shape, so the name and icon arrive without moving anything. */}
      {!mounted && ChainIcon && (
        <SkeletonBox width="1.5rem" height="1.5rem" radius="9999px" style={{ flexShrink: 0 }} />
      )}
      {mounted && currentChain && ChainIcon && (
        <div className="size-6">
          <ChainIcon {...chainIconProps(currentChain.id, variant, monoColor, "rounded-full")} />
        </div>
      )}
      <div className="flex items-center gap-2">
        {mounted ? (
          <span className={cn(iconOnly && "sr-only")}>
            <MorphText disabled={iconOnly}>{chainName}</MorphText>
          </span>
        ) : (
          <span className={cn(iconOnly && "sr-only")}>
            <span className="sr-only">{chainName}</span>
            {/* About the width of "Ethereum", inline so it takes a line of text's height. */}
            {!iconOnly && (
              <SkeletonBox
                width="4.5em"
                height="1em"
                style={{ display: "inline-block", verticalAlign: "middle" }}
              />
            )}
          </span>
        )}
        {ChevronIcon && (
          <span
            className={cn(
              "transition-transform h-fit w-fit",
              open && "rotate-180",
              isPending && "hidden",
            )}
          >
            <ChevronIcon className="size-4 shrink-0" />
          </span>
        )}
        {isPending && LoaderIcon && <LoaderIcon className="size-4 shrink-0 animate-spin" />}
      </div>
    </>
  );
}

function ChainItem({
  chain,
  meta,
  isActive,
  isSwitching,
  disabled,
  onSwitch,
  ChainIcon,
  variant,
  monoColor,
  LoaderIcon,
}: {
  chain: Chain;
  meta?: ReactNode;
  isActive: boolean;
  isSwitching: boolean;
  disabled: boolean;
  onSwitch: (chainId: number) => void;
  ChainIcon?: ComponentType<ChainIconProps>;
  variant: "branded" | "mono" | "background";
  monoColor?: string;
  LoaderIcon?: ComponentType<{ className?: string }>;
}) {
  return (
    <ButtonPrimitive
      onClick={() => onSwitch(chain.id)}
      disabled={disabled || isActive}
      aria-current={isActive || undefined}
      data-agent-confirm={`Asks your wallet to switch to ${chain.name}`}
      className={cn(
        "flex items-center w-full gap-2 p-2 rounded-md hover:bg-accent/20 group active:scale-97 cursor-pointer disabled:cursor-default disabled:opacity-50",
        isActive && "bg-accent/20 opacity-100",
      )}
    >
      {ChainIcon && (
        <ChainIcon {...chainIconProps(chain.id, variant, monoColor, "rounded-full border")} />
      )}
      <div className="flex min-w-0 flex-col items-start text-left">
        <span className="text-sm">{chain.name}</span>{" "}
        {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
      </div>
      {isActive && <CheckIcon className="size-4 ml-auto shrink-0" />}
      {isSwitching && LoaderIcon && <LoaderIcon className="size-4 ml-auto shrink-0 animate-spin" />}
    </ButtonPrimitive>
  );
}

function ChainsGrid({
  chains,
  chainMeta,
  currentChainId,
  pendingChainId,
  isPending,
  onSwitch,
  ChainIcon,
  LoaderIcon,
  variant,
  monoColor,
}: {
  chains: readonly Chain[];
  chainMeta?: (chain: Chain) => ReactNode;
  currentChainId?: number;
  pendingChainId?: number;
  isPending: boolean;
  onSwitch: (chainId: number) => void;
  ChainIcon?: ComponentType<ChainIconProps>;
  LoaderIcon?: ComponentType<{ className?: string }>;
  variant: "branded" | "mono" | "background";
  monoColor?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 w-full">
      {chains.map((chain) => (
        <ChainItem
          key={chain.id}
          chain={chain}
          meta={chainMeta?.(chain)}
          isActive={chain.id === currentChainId}
          isSwitching={chain.id === pendingChainId}
          disabled={isPending}
          onSwitch={onSwitch}
          ChainIcon={ChainIcon}
          LoaderIcon={LoaderIcon}
          variant={variant}
          monoColor={monoColor}
        />
      ))}
    </div>
  );
}

function ChainListContent({
  mounted,
  chains,
  groupByNetwork,
  error,
  cancelled,
  unsupported,
  ...gridProps
}: {
  mounted: boolean;
  chains: readonly Chain[];
  groupByNetwork?: boolean;
  error: { message: string; shortMessage?: string } | null;
  cancelled: boolean;
  unsupported: boolean;
  chainMeta?: (chain: Chain) => ReactNode;
  currentChainId?: number;
  pendingChainId?: number;
  isPending: boolean;
  onSwitch: (chainId: number) => void;
  ChainIcon?: ComponentType<ChainIconProps>;
  LoaderIcon?: ComponentType<{ className?: string }>;
  variant: "branded" | "mono" | "background";
  monoColor?: string;
}) {
  if (!mounted) {
    return (
      <div className="flex flex-col gap-1">
        <span className="sr-only">Loading chains</span>
        {[0, 1, 2].map((row) => (
          <SkeletonBox key={row} width="100%" height="2.25rem" />
        ))}
      </div>
    );
  }

  const { mainnet, testnet } = groupByNetwork
    ? groupChainsByNetwork(chains)
    : { mainnet: chains, testnet: [] as Chain[] };

  const empty = (label: string) => (
    <p className="text-sm text-muted-foreground text-center py-4">No {label} chains available</p>
  );

  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error.shortMessage ?? error.message}
        </p>
      )}
      {unsupported && (
        <p className="text-sm text-destructive">
          Your wallet is on a network this app doesn't support. Pick one below.
        </p>
      )}
      {cancelled && (
        <p role="status" className="text-sm text-muted-foreground">
          Request cancelled in wallet
        </p>
      )}
      {groupByNetwork && (mainnet.length > 0 || testnet.length > 0) ? (
        <Tabs defaultValue={mainnet.length > 0 ? "mainnet" : "testnet"} className="w-full">
          <TabsList aria-label="Network type" className="grid w-full grid-cols-2">
            <TabsTab value="mainnet" disabled={mainnet.length === 0}>
              Mainnet
            </TabsTab>
            <TabsTab value="testnet" disabled={testnet.length === 0}>
              Testnet
            </TabsTab>
          </TabsList>
          <TabsPanel value="mainnet" className="mt-2">
            {mainnet.length > 0 ? <ChainsGrid chains={mainnet} {...gridProps} /> : empty("mainnet")}
          </TabsPanel>
          <TabsPanel value="testnet" className="mt-2">
            {testnet.length > 0 ? <ChainsGrid chains={testnet} {...gridProps} /> : empty("testnet")}
          </TabsPanel>
        </Tabs>
      ) : (
        <ChainsGrid chains={chains} {...gridProps} />
      )}
    </>
  );
}

function useChainSelectorParts(props: ChainSelectorProps) {
  const {
    disableIcons = false,
    iconOnly = false,
    variant = "background",
    monoColor,
    groupByNetwork = false,
  } = props;

  const switcher = useChainSwitcher();
  const icons = resolveIcons(props);

  const chainName = !switcher.mounted
    ? "Select Chain"
    : switcher.unsupported
      ? "Wrong network"
      : switcher.currentChain?.name || "Select Chain";

  return {
    ...switcher,
    ...icons,
    chainName,
    ariaLabel: iconOnly ? `Network: ${chainName}` : undefined,
    tooltipTitle: iconOnly ? chainName : undefined,
    iconOnly,
    disableIcons,
    variant,
    monoColor,
    groupByNetwork,
    chainMeta: props.chainMeta,
  };
}

export function ChainSelector(props: ChainSelectorProps) {
  const s = useChainSelectorParts(props);

  return (
    <Popover open={s.open} onOpenChange={s.onOpenChange}>
      <PopoverTrigger
        className={triggerClassName(s)}
        aria-label={s.ariaLabel}
        title={s.tooltipTitle}
      >
        <TriggerContent
          mounted={s.mounted}
          unsupported={s.unsupported}
          currentChain={s.currentChain}
          chainName={s.chainName}
          iconOnly={s.iconOnly}
          open={s.open}
          isPending={s.isPending}
          variant={s.variant}
          monoColor={s.monoColor}
          ChainIcon={s.ChainIcon}
          ChevronIcon={s.ChevronIcon}
          LoaderIcon={s.LoaderIcon}
        />
      </PopoverTrigger>
      <PopoverContent className="flex w-max max-w-[calc(100vw-2rem)] min-w-48 flex-col gap-4">
        <PopoverTitle>Select Network</PopoverTitle>
        <ChainListContent
          mounted={s.mounted}
          chains={s.chains}
          groupByNetwork={s.groupByNetwork}
          error={s.error}
          cancelled={s.cancelled}
          unsupported={s.unsupported}
          chainMeta={s.chainMeta}
          currentChainId={s.currentChain?.id}
          pendingChainId={s.pendingChainId}
          isPending={s.isPending}
          onSwitch={s.onSwitch}
          ChainIcon={s.ChainIcon}
          LoaderIcon={s.LoaderIcon}
          variant={s.variant}
          monoColor={s.monoColor}
        />
      </PopoverContent>
    </Popover>
  );
}

export function ChainSelectorDialog(props: ChainSelectorProps) {
  const s = useChainSelectorParts(props);

  return (
    <Dialog open={s.open} onOpenChange={s.onOpenChange}>
      <DialogTrigger
        className={triggerClassName(s)}
        aria-label={s.ariaLabel}
        title={s.tooltipTitle}
      >
        <TriggerContent
          mounted={s.mounted}
          unsupported={s.unsupported}
          currentChain={s.currentChain}
          chainName={s.chainName}
          iconOnly={s.iconOnly}
          open={s.open}
          isPending={s.isPending}
          variant={s.variant}
          monoColor={s.monoColor}
          ChainIcon={s.ChainIcon}
          ChevronIcon={s.ChevronIcon}
          LoaderIcon={s.LoaderIcon}
        />
      </DialogTrigger>
      <DialogContent className="min-w-96" closeLabel="Close network picker">
        <DialogHeader>
          <DialogTitle>Select Network</DialogTitle>
        </DialogHeader>
        <ChainListContent
          mounted={s.mounted}
          chains={s.chains}
          groupByNetwork={s.groupByNetwork}
          error={s.error}
          cancelled={s.cancelled}
          unsupported={s.unsupported}
          chainMeta={s.chainMeta}
          currentChainId={s.currentChain?.id}
          pendingChainId={s.pendingChainId}
          isPending={s.isPending}
          onSwitch={s.onSwitch}
          ChainIcon={s.ChainIcon}
          LoaderIcon={s.LoaderIcon}
          variant={s.variant}
          monoColor={s.monoColor}
        />
      </DialogContent>
    </Dialog>
  );
}
