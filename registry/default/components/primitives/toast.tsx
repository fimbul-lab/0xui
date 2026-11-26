import { OverlayHost } from "@ui-sdk/react/overlays";
import type { Overlays } from "@ui-sdk/react/overlays";
import {
  Toast,
  ToastAction,
  ToastDescription,
  ToastRegion,
  ToastTitle,
  createToaster,
  toast,
} from "@ui-sdk/react/toast";
import type { ToastRegionProps, ToastType, Toaster as ToasterQueue } from "@ui-sdk/react/toast";
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { withClassName } from "@/lib/class-name";

const icons: Partial<Record<ToastType, ReactNode>> = {
  success: <CircleCheckIcon aria-hidden className="size-4" />,
  info: <InfoIcon aria-hidden className="size-4" />,
  warning: <TriangleAlertIcon aria-hidden className="size-4" />,
  error: <OctagonXIcon aria-hidden className="size-4" />,
  loading: <Loader2Icon aria-hidden className="size-4 animate-spin" />,
};

const regionClassName =
  "group/toaster fixed inset-auto z-60 m-6 w-[356px] max-w-[calc(100vw-3rem)] overflow-visible border-0 bg-transparent p-0 " +
  "data-[side=bottom]:bottom-0 data-[side=top]:top-0 data-[align=end]:end-0 data-[align=start]:start-0 data-[align=center]:left-1/2 data-[align=center]:-translate-x-1/2 " +
  "data-[side=bottom]:[--toast-dir:-1] data-[side=top]:[--toast-dir:1] h-(--toast-front-height) data-expanded:h-[calc(var(--toast-stack-height)+(var(--toast-count)-1)*14px)] " +
  "[&_[data-slot=toast-list]]:m-0 [&_[data-slot=toast-list]]:list-none [&_[data-slot=toast-list]]:p-0";

// The stack: toasts sit on the region's edge, peek out by index while collapsed, and spread by their offsets while expanded.
const toastClassName =
  "absolute inset-x-0 z-[calc(100-var(--toast-index))] flex h-(--toast-height) items-center gap-1.5 overflow-hidden rounded-lg border bg-popover p-4 text-[13px] text-popover-foreground shadow-lg select-none " +
  "group-data-[side=bottom]/toaster:bottom-0 group-data-[side=top]/toaster:top-0 " +
  "[--y:calc(var(--toast-index)*14px*var(--toast-dir))] [translate:var(--toast-swipe-x,0px)_calc(var(--y)+var(--toast-swipe-y,0px))] [scale:calc(1-var(--toast-index)*0.05)] " +
  "data-expanded:[--y:calc((var(--toast-offset)+var(--toast-index)*14px)*var(--toast-dir))] data-expanded:[scale:1] " +
  "not-data-front:not-data-expanded:h-(--toast-front-height) not-data-front:not-data-expanded:*:opacity-0 " +
  "transition-[translate,scale,opacity,height] duration-400 *:transition-opacity data-starting-style:transition-none data-swiping:transition-none " +
  "data-starting-style:opacity-0 data-starting-style:data-front:[--y:calc(-100%*var(--toast-dir))] data-ending-style:opacity-0 motion-reduce:transition-opacity";

const actionClassName =
  "ml-auto inline-flex h-6 shrink-0 cursor-pointer items-center rounded-sm bg-primary px-2 text-xs font-medium text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 data-pending:cursor-progress data-pending:opacity-60";

function renderToast(item: Parameters<NonNullable<ToastRegionProps["children"]>>[0]) {
  const href = item.action?.href;
  return (
    <Toast
      className={toastClassName}
      render={(props, state) => (
        <li {...props} inert={state.leaving || (!state.expanded && state.index > 0) || undefined} />
      )}
    >
      {icons[item.type]}
      <div className="flex min-w-0 flex-col gap-0.5">
        <ToastTitle className="font-medium" />
        <ToastDescription className="text-muted-foreground" />
      </div>
      {item.action && (
        <ToastAction
          className={actionClassName}
          {...(href && /^https?:\/\//.test(href)
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {})}
        />
      )}
    </Toast>
  );
}

export type ToasterProps = Omit<ToastRegionProps, "toaster" | "children"> & {
  /** A queue from `createToaster()`. Without one, it shows the shared `toast()` queue through `OverlayHost`. */
  toaster?: ToasterQueue<any>;
  /** The overlay registry `OverlayHost` renders. Defaults to the shared one. */
  overlays?: Overlays;
};

/** Shows toasts in a stack at the edge of the page. Mount it once, near the root of your app, then call `toast()`. */
function Toaster({
  toaster,
  overlays,
  className,
  side = "bottom",
  align = "end",
  ...props
}: ToasterProps) {
  const regionProps = {
    ...props,
    side,
    align,
    className: withClassName(regionClassName, className),
    children: renderToast,
  };
  if (toaster) return <ToastRegion toaster={toaster} {...regionProps} />;
  return <OverlayHost overlays={overlays} toast={regionProps} />;
}

export { Toaster, createToaster, toast };
