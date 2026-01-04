"use client";
import type * as PageTree from "fumadocs-core/page-tree";
import { type ComponentProps, type ReactNode, useMemo } from "react";
import { cn } from "../../../lib/cn";
import { TreeContextProvider, useTreeContext } from "fumadocs-ui/contexts/tree";
import Link from "fumadocs-core/link";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import { cva } from "class-variance-authority";
import { usePathname } from "fumadocs-core/framework";
import {
  SidebarProvider,
  SidebarTrigger,
  SidebarDrawerContent,
  SidebarDrawerOverlay,
  SidebarViewport,
  SidebarItem as BaseSidebarItem,
  SidebarFolder,
  SidebarFolderTrigger,
  SidebarFolderLink,
  SidebarFolderContent,
  SidebarSeparator as BaseSidebarSeparator,
} from "fumadocs-ui/components/sidebar/base";
import { ChevronRight, Menu } from "lucide-react";

export interface DocsLayoutProps {
  tree: PageTree.Root;
  children: ReactNode;
}

export function DocsLayout({ tree, children }: DocsLayoutProps) {
  return (
    <TreeContextProvider tree={tree}>
      <SidebarProvider>
        <header className="sticky top-0 bg-fd-background h-14 z-30 border-b border-fd-border/50">
          <nav className="flex flex-row items-center gap-2 size-full px-4">
            <Link href="/" className="font-medium mr-auto">
              <img
                src="/img/logos/0xui-logo-full-icon.svg"
                alt="0xui"
                className="w-20"
              />
            </Link>

            <SearchToggle />
            <SidebarTrigger className="inline-flex items-center justify-center size-9 rounded-md text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-accent transition-colors md:hidden">
              <Menu className="size-5" />
            </SidebarTrigger>
          </nav>
        </header>
        <main
          id="nd-docs-layout"
          className="flex flex-1 flex-row [--fd-nav-height:56px]"
        >
          <Sidebar />
          {children}
        </main>
      </SidebarProvider>
    </TreeContextProvider>
  );
}

function SearchToggle(props: ComponentProps<"button">) {
  const { enabled, setOpenSearch } = useSearchContext();
  if (!enabled) return null;

  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center gap-2 text-sm text-fd-muted-foreground hover:text-fd-foreground transition-colors px-3 py-1.5 rounded-md hover:bg-fd-accent",
        props.className
      )}
      onClick={() => setOpenSearch(true)}
    >
      Search
    </button>
  );
}

function Sidebar() {
  const { root } = useTreeContext();

  const sidebarContent = useMemo(() => {
    function renderItems(items: PageTree.Node[]) {
      return items.map((item) => (
        <SidebarItemRenderer key={item.$id} item={item}>
          {item.type === "folder" ? renderItems(item.children) : null}
        </SidebarItemRenderer>
      ));
    }

    return renderItems(root.children);
  }, [root]);

  return (
    <>
      {/* Mobile drawer overlay - only renders when mode is "drawer" */}
      <SidebarDrawerOverlay className="fixed inset-0 z-40 bg-fd-background/80 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in" />

      {/* Mobile drawer - only renders when mode is "drawer" */}
      <SidebarDrawerContent className="fixed inset-y-0 left-0 z-50 w-72 border-r border-fd-border bg-fd-card data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:animate-in data-[state=open]:slide-in-from-left">
        <SidebarViewport className="h-full p-4 pt-16">
          <div className="flex flex-col gap-1">{sidebarContent}</div>
        </SidebarViewport>
      </SidebarDrawerContent>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col shrink-0 sticky top-14 z-20 h-[calc(100dvh-56px)] w-[260px] border-r border-fd-border/50 bg-fd-card/50">
        <SidebarViewport className="flex-1 p-4 overflow-auto">
          <div className="flex flex-col gap-1">{sidebarContent}</div>
        </SidebarViewport>
      </aside>
    </>
  );
}

const linkVariants = cva(
  "group flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-all duration-200 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      active: {
        true: "bg-fd-primary/10 text-fd-primary font-medium",
        false:
          "text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-accent",
      },
    },
    defaultVariants: {
      active: false,
    },
  }
);

const folderTriggerVariants = cva(
  "group flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-all duration-200 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      active: {
        true: "text-fd-foreground font-medium",
        false:
          "text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-accent",
      },
    },
    defaultVariants: {
      active: false,
    },
  }
);

function SidebarItemRenderer({
  item,
  children,
}: {
  item: PageTree.Node;
  children: ReactNode;
}) {
  const pathname = usePathname();

  if (item.type === "page") {
    return (
      <BaseSidebarItem
        href={item.url}
        icon={item.icon}
        className={linkVariants({
          active: pathname === item.url,
        })}
      >
        {item.name}
      </BaseSidebarItem>
    );
  }

  if (item.type === "separator") {
    return (
      <BaseSidebarSeparator className="text-xs font-semibold text-fd-muted-foreground uppercase tracking-wider mt-6 mb-2 px-3 first:mt-0">
        {item.icon}
        {item.name}
      </BaseSidebarSeparator>
    );
  }

  // Folder type
  const isActive = item.index ? pathname === item.index.url : false;
  const hasActiveChild = item.children.some((child) => {
    if (child.type === "page") return pathname === child.url;
    if (child.type === "folder" && child.index)
      return pathname === child.index.url;
    return false;
  });

  return (
    <SidebarFolder
      defaultOpen={isActive || hasActiveChild}
      active={isActive || hasActiveChild}
    >
      <div className="flex items-center">
        {item.index ? (
          <SidebarFolderLink
            href={item.index.url}
            className={cn(
              folderTriggerVariants({ active: isActive }),
              "flex-1 rounded-r-none"
            )}
          >
            {item.index.icon}
            {item.index.name}
          </SidebarFolderLink>
        ) : (
          <SidebarFolderTrigger
            className={cn(
              folderTriggerVariants({ active: hasActiveChild }),
              "flex-1"
            )}
          >
            {item.icon}
            {item.name}
            <ChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]:rotate-90" />
          </SidebarFolderTrigger>
        )}
        {item.index && (
          <SidebarFolderTrigger className="p-2 rounded-lg hover:bg-fd-accent transition-colors rounded-l-none">
            <ChevronRight className="size-4 transition-transform duration-200 group-data-[state=open]:rotate-90" />
          </SidebarFolderTrigger>
        )}
      </div>
      <SidebarFolderContent className="overflow-hidden data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
        <div className="ml-3 pl-3 border-l border-fd-border/50 flex flex-col gap-1 mt-1">
          {children}
        </div>
      </SidebarFolderContent>
    </SidebarFolder>
  );
}
