import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, Loader2Icon } from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { Chain } from "viem";
import { useChainId, useChains, useSwitchChain } from "wagmi";
import { NetworkIcon } from "@web3icons/react/dynamic";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

type ChainIconProps =
  | {
      chainId: number;
      className?: string;
      variant: "mono";
      monoColor?: string;
    }
  | {
      chainId: number;
      className?: string;
      variant?: "branded" | "background";
      monoColor?: never;
    };

type ChainSelectorProps =
  | {
      /** Custom chain icon component. Receives chainId, className, and variant props. */
      chainIcon?: ComponentType<ChainIconProps> | false;
      /** Custom chevron icon component. Receives className prop. */
      chevronIcon?: ComponentType<{ className?: string }> | false;
      /** Custom loader icon component. Receives className prop. */
      loaderIcon?: ComponentType<{ className?: string }> | false;
      /** Disable all icons. Overrides individual icon props. */
      disableIcons?: boolean;
      /** Show only icons without visible labels. Label remains accessible via tooltip and screen readers. */
      iconOnly?: boolean;
      /** Icon style. */
      variant: "mono";
      /** Color for mono variant icons. Only applies when variant is "mono". */
      monoColor?: string;
      /** Group chains by network type (mainnet/testnet) with tabs. */
      groupByNetwork?: boolean;
    }
  | {
      /** Custom chain icon component. Receives chainId, className, and variant props. */
      chainIcon?: ComponentType<ChainIconProps> | false;
      /** Custom chevron icon component. Receives className prop. */
      chevronIcon?: ComponentType<{ className?: string }> | false;
      /** Custom loader icon component. Receives className prop. */
      loaderIcon?: ComponentType<{ className?: string }> | false;
      /** Disable all icons. Overrides individual icon props. */
      disableIcons?: boolean;
      /** Show only icons without visible labels. Label remains accessible via tooltip and screen readers. */
      iconOnly?: boolean;
      /** Icon style. */
      variant?: "branded" | "background";
      /** Color for mono variant icons. Only applies when variant is "mono". */
      monoColor?: never;
      /** Group chains by network type (mainnet/testnet) with tabs. */
      groupByNetwork?: boolean;
    };

function ChainItem({
  chain,
  onSwitch,
  chainIcon,
  showChainIcon,
  variant = "background",
  monoColor,
}: {
  chain: Chain;
  onSwitch?: (chainId: number) => void;
  chainIcon?: ComponentType<ChainIconProps>;
  showChainIcon: boolean;
  variant?: "branded" | "mono" | "background";
  monoColor?: string;
}) {
  const IconComponent = chainIcon;

  const iconProps =
    variant === "mono"
      ? {
          chainId: chain.id,
          variant: "mono" as const,
          monoColor,
          className: "rounded-full border ",
        }
      : {
          chainId: chain.id,
          variant: variant as "branded" | "background",
          className: "rounded-full border ",
        };

  return (
    <button
      key={chain.id}
      onClick={async () => {
        try {
          onSwitch?.(chain.id);
        } catch (error) {
          console.error("Failed to switch chain:", error);
        }
      }}
      className="flex items-center w-full  gap-2 p-2 hover:bg-accent/20 group active:scale-97 cursor-pointer "
    >
      {showChainIcon && IconComponent && <IconComponent {...iconProps} />}
      <div className="text-sm">{chain.name}</div>
    </button>
  );
}

function FallbackIcon({ className }: { className?: string }) {
  return (
    <Avatar className={cn("size-6", className)}>
      <AvatarFallback>?</AvatarFallback>
    </Avatar>
  );
}

function DefaultChainIcon({
  chainId,
  className,
  variant,
  monoColor,
}: ChainIconProps) {
  if (!chainId) return null;

  return (
    <NetworkIcon
      key={chainId}
      variant={variant}
      chainId={chainId}
      color={variant === "mono" && monoColor ? monoColor : undefined}
      className={cn("size-6 ", className)}
      fallback={<FallbackIcon className={className} />}
    />
  );
}

function groupChainsByNetwork(chains: readonly Chain[]) {
  const mainnet: Chain[] = [];
  const testnet: Chain[] = [];

  chains.forEach((chain) => {
    // Check if chain has testnet property (viem chains have this)
    if ((chain as Chain & { testnet?: boolean }).testnet) {
      testnet.push(chain);
    } else {
      mainnet.push(chain);
    }
  });

  return { mainnet, testnet };
}

function ChainsGrid({
  chains,
  variant,
  ChainIconComponent,
  onSwitch,
  monoColor,
}: {
  chains: readonly Chain[];
  variant?: "branded" | "mono" | "background";
  ChainIconComponent?: ComponentType<ChainIconProps>;
  onSwitch: (chainId: number) => void;
  monoColor?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 w-full">
      {chains.map((chain) => (
        <ChainItem
          variant={variant}
          key={chain.id}
          chain={chain}
          onSwitch={() => onSwitch(chain.id)}
          chainIcon={ChainIconComponent}
          showChainIcon={!!ChainIconComponent}
          {...(variant === "mono" && monoColor ? { monoColor } : {})}
        />
      ))}
    </div>
  );
}

export function ChainSelector({
  chainIcon,
  chevronIcon,
  loaderIcon,
  disableIcons = false,
  iconOnly = false,
  variant = "background",
  monoColor,
  groupByNetwork = false,
}: ChainSelectorProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const chainId = useChainId();
  const chains = useChains();
  const currentChain = chains.find((c) => c.id === chainId);

  useEffect(() => {
    setMounted(true);
  }, []);

  const { mutateAsync, isPending } = useSwitchChain();

  const onSwitch = async (chainId: number) => {
    try {
      await mutateAsync({ chainId });
      setOpen(false);
    } catch (error) {
      console.error("Failed to switch chain:", error);
    }
  };

  // Determine which icons to use
  const showIcons = !disableIcons;
  const ChainIconComponent = showIcons
    ? chainIcon === false
      ? undefined
      : chainIcon || DefaultChainIcon
    : undefined;
  const ChevronIconComponent = showIcons
    ? chevronIcon === false
      ? undefined
      : chevronIcon || ChevronDownIcon
    : undefined;
  const LoaderIconComponent = showIcons
    ? loaderIcon === false
      ? undefined
      : loaderIcon || Loader2Icon
    : undefined;

  const chainName = mounted
    ? currentChain?.name || "Select Chain"
    : "Select Chain";
  const ariaLabel = iconOnly ? chainName : undefined;
  const tooltipTitle = iconOnly ? chainName : undefined;

  const { mainnet, testnet } = groupByNetwork
    ? groupChainsByNetwork(chains)
    : { mainnet: chains, testnet: [] };

  return (
    <div className="flex flex-col gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={cn(
            "flex items-center gap-2 justify-between border transition-all w-fit py-2 pl-1.5 px-3 rounded-full hover:bg-accent/10 active:scale-97 cursor-pointer",
            iconOnly ? "min-w-fit gap-1 py-1 px-1 pl-1" : "min-w-30"
          )}
          aria-label={ariaLabel}
          title={tooltipTitle}
        >
          {mounted && currentChain && ChainIconComponent && (
            <div className="h-fit w-fit  ">
              {variant === "mono" ? (
                <ChainIconComponent
                  chainId={currentChain.id}
                  variant="mono"
                  monoColor={monoColor}
                  className=" rounded-full "
                />
              ) : (
                <ChainIconComponent
                  chainId={currentChain.id}
                  variant={variant}
                  className=" rounded-full "
                />
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <span
              suppressHydrationWarning
              className={cn(iconOnly && "sr-only")}
            >
              {chainName}
            </span>
            {ChevronIconComponent && (
              <span
                className={cn(
                  "transition-transform",
                  open ? "rotate-180" : "",
                  isPending && "hidden"
                )}
              >
                <ChevronIconComponent className="size-4 shrink-0" />
              </span>
            )}
            {isPending && LoaderIconComponent && (
              <LoaderIconComponent className="size-4 shrink-0 animate-spin" />
            )}
          </div>
        </PopoverTrigger>
        <PopoverContent className="p- min-w-48 flex flex-col gap-4 w-full">
          <div>Select Network</div>
          {mounted ? (
            groupByNetwork && (mainnet.length > 0 || testnet.length > 0) ? (
              <Tabs defaultValue="mainnet" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="mainnet" disabled={mainnet.length === 0}>
                    Mainnet
                  </TabsTrigger>
                  <TabsTrigger value="testnet" disabled={testnet.length === 0}>
                    Testnet
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="mainnet" className="mt-2">
                  {mainnet.length > 0 ? (
                    <ChainsGrid
                      chains={mainnet}
                      variant={variant}
                      ChainIconComponent={ChainIconComponent}
                      onSwitch={onSwitch}
                      monoColor={monoColor}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No mainnet chains available
                    </p>
                  )}
                </TabsContent>
                <TabsContent value="testnet" className="mt-2">
                  {testnet.length > 0 ? (
                    <ChainsGrid
                      chains={testnet}
                      variant={variant}
                      ChainIconComponent={ChainIconComponent}
                      onSwitch={onSwitch}
                      monoColor={monoColor}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No testnet chains available
                    </p>
                  )}
                </TabsContent>
              </Tabs>
            ) : (
              <ChainsGrid
                chains={chains}
                variant={variant}
                ChainIconComponent={ChainIconComponent}
                onSwitch={onSwitch}
                monoColor={monoColor}
              />
            )
          ) : (
            <p className="text-sm text-muted-foreground">Loading chains...</p>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function ChainSelectorDialog({
  chainIcon,
  chevronIcon,
  loaderIcon,
  disableIcons = false,
  iconOnly = false,
  variant = "background",
  monoColor,
  groupByNetwork = false,
}: ChainSelectorProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const chainId = useChainId();
  const chains = useChains();
  const currentChain = chains.find((c) => c.id === chainId);

  useEffect(() => {
    setMounted(true);
  }, []);

  const { mutateAsync, isPending } = useSwitchChain();

  const onSwitch = async (chainId: number) => {
    try {
      await mutateAsync({ chainId });
      setOpen(false);
    } catch (error) {
      console.error("Failed to switch chain:", error);
    }
  };

  // Determine which icons to use
  const showIcons = !disableIcons;
  const ChainIconComponent = showIcons
    ? chainIcon === false
      ? undefined
      : chainIcon || DefaultChainIcon
    : undefined;
  const ChevronIconComponent = showIcons
    ? chevronIcon === false
      ? undefined
      : chevronIcon || ChevronDownIcon
    : undefined;
  const LoaderIconComponent = showIcons
    ? loaderIcon === false
      ? undefined
      : loaderIcon || Loader2Icon
    : undefined;

  const chainName = mounted
    ? currentChain?.name || "Select Chain"
    : "Select Chain";
  const ariaLabel = iconOnly ? chainName : undefined;
  const tooltipTitle = iconOnly ? chainName : undefined;

  const { mainnet, testnet } = groupByNetwork
    ? groupChainsByNetwork(chains)
    : { mainnet: chains, testnet: [] };

  return (
    <div className="flex flex-col gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          className={cn(
            "flex items-center gap-2 justify-between border transition-all w-fit py-2 pl-1.5 px-3 rounded-full hover:bg-accent/10 active:scale-97 cursor-pointer",
            iconOnly ? "min-w-fit gap-1 py-1 px-1 pl-1" : "min-w-30"
          )}
          aria-label={ariaLabel}
          title={tooltipTitle}
        >
          {mounted && currentChain && ChainIconComponent && (
            <div className="h-fit w-fit  ">
              {variant === "mono" ? (
                <ChainIconComponent
                  chainId={currentChain.id}
                  variant="mono"
                  monoColor={monoColor}
                  className=" rounded-full "
                />
              ) : (
                <ChainIconComponent
                  chainId={currentChain.id}
                  variant={variant}
                  className=" rounded-full "
                />
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <span
              suppressHydrationWarning
              className={cn(iconOnly && "sr-only")}
            >
              {chainName}
            </span>
            {ChevronIconComponent && (
              <span
                className={cn(
                  "transition-transform",
                  open ? "rotate-180" : "",
                  isPending && "hidden"
                )}
              >
                <ChevronIconComponent className="size-4 shrink-0" />
              </span>
            )}
            {isPending && LoaderIconComponent && (
              <LoaderIconComponent className="size-4 shrink-0 animate-spin" />
            )}
          </div>
        </DialogTrigger>
        <DialogContent className="min-w-96">
          <DialogHeader>
            <DialogTitle>Select Network</DialogTitle>
          </DialogHeader>
          {mounted ? (
            groupByNetwork && (mainnet.length > 0 || testnet.length > 0) ? (
              <Tabs defaultValue="mainnet" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="mainnet" disabled={mainnet.length === 0}>
                    Mainnet
                  </TabsTrigger>
                  <TabsTrigger value="testnet" disabled={testnet.length === 0}>
                    Testnet
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="mainnet" className="mt-2">
                  {mainnet.length > 0 ? (
                    <ChainsGrid
                      chains={mainnet}
                      variant={variant}
                      ChainIconComponent={ChainIconComponent}
                      onSwitch={onSwitch}
                      monoColor={monoColor}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No mainnet chains available
                    </p>
                  )}
                </TabsContent>
                <TabsContent value="testnet" className="mt-2">
                  {testnet.length > 0 ? (
                    <ChainsGrid
                      chains={testnet}
                      variant={variant}
                      ChainIconComponent={ChainIconComponent}
                      onSwitch={onSwitch}
                      monoColor={monoColor}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No testnet chains available
                    </p>
                  )}
                </TabsContent>
              </Tabs>
            ) : (
              <ChainsGrid
                chains={chains}
                variant={variant}
                ChainIconComponent={ChainIconComponent}
                onSwitch={onSwitch}
                monoColor={monoColor}
              />
            )
          ) : (
            <p className="text-sm text-muted-foreground">Loading chains...</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
