import {
  Tabs as TabsPrimitive,
  TabsList as TabsListPrimitive,
  TabsPanel as TabsPanelPrimitive,
  TabsTab as TabsTabPrimitive,
} from "@ui-sdk/react/tabs";
import type { ComponentProps } from "react";
import { withClassName } from "@/lib/class-name";

function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive>) {
  return (
    <TabsPrimitive
      className={withClassName(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className,
      )}
      {...props}
    />
  );
}

function TabsList({ className, ...props }: ComponentProps<typeof TabsListPrimitive>) {
  return (
    <TabsListPrimitive
      className={withClassName(
        "inline-flex w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground data-[orientation=horizontal]:h-8 data-[orientation=vertical]:h-fit data-[orientation=vertical]:flex-col",
        className,
      )}
      {...props}
    />
  );
}

function TabsTab({ className, ...props }: ComponentProps<typeof TabsTabPrimitive>) {
  return (
    <TabsTabPrimitive
      className={withClassName(
        "relative inline-flex h-[calc(100%-1px)] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring data-disabled:pointer-events-none data-disabled:opacity-50 data-[orientation=vertical]:w-full data-[orientation=vertical]:justify-start dark:text-muted-foreground dark:hover:text-foreground aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-sm dark:aria-selected:border-input dark:aria-selected:bg-input/30 dark:aria-selected:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function TabsPanel({ className, ...props }: ComponentProps<typeof TabsPanelPrimitive>) {
  return (
    <TabsPanelPrimitive className={withClassName("flex-1 text-sm outline-none", className)} {...props} />
  );
}

export { Tabs, TabsList, TabsPanel, TabsTab };
