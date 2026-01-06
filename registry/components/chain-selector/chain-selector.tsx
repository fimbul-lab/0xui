import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, Loader2Icon } from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { Chain } from "viem";
import { useChainId, useChains, useSwitchChain } from "wagmi";
import { NetworkIcon } from "@web3icons/react/dynamic";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

type ChainIconProps = {
  chainId: number;
  className?: string;
  variant?: "branded" | "mono" | "background";
};

type ChainSelectorProps = {
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
};

function ChainItem({
  chain,
  onSwitch,
  chainIcon,
  showChainIcon,
}: {
  chain: Chain;
  onSwitch?: (chainId: number) => void;
  chainIcon?: ComponentType<ChainIconProps>;
  showChainIcon: boolean;
}) {
  const IconComponent = chainIcon;

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
      {showChainIcon && IconComponent && (
        <IconComponent
          chainId={chain.id}
          variant="background"
          className="rounded-full border"
        />
      )}
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

function DefaultChainIcon({ chainId, className, variant }: ChainIconProps) {
  if (!chainId) return null;

  return (
    <NetworkIcon
      key={chainId}
      variant={variant}
      chainId={chainId}
      className={cn("size-6", className)}
      fallback={<FallbackIcon className={className} />}
    />
  );
}

export function ChainSelector({
  chainIcon,
  chevronIcon,
  loaderIcon,
  disableIcons = false,
  iconOnly = false,
}: ChainSelectorProps = {}) {
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
              <ChainIconComponent
                chainId={currentChain.id}
                variant="background"
                className=" rounded-full"
              />
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
        <PopoverContent className=" p- min-w-48 flex flex-col gap-4 bg-black w-full ">
          <div>Select Network</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 w-full">
            {mounted ? (
              chains.map((chain) => (
                <ChainItem
                  key={chain.id}
                  chain={chain}
                  onSwitch={() => onSwitch(chain.id)}
                  chainIcon={ChainIconComponent}
                  showChainIcon={!!ChainIconComponent}
                />
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Loading chains...</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
