import { useState } from "react";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import type { ResponsiveDialogMode } from "@/components/responsive-dialog";
import { Button } from "@/components/primitives/button";
import { demo } from "./demo";

function Example({ mode, label }: { mode?: ResponsiveDialogMode; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ResponsiveDialog
        open={open}
        onOpenChange={setOpen}
        title="Slippage"
        description="Choose how much the price may move before the swap is cancelled."
        mode={mode}
        className="sm:data-[presentation=dialog]:max-w-sm"
      >
        <p className="text-sm text-muted-foreground">
          Your swap is cancelled if the price moves more than this before it confirms.
        </p>
        <div className="flex gap-2">
          {["0.1%", "0.5%", "1%"].map((value) => (
            <Button key={value} variant="outline" className="flex-1" onClick={() => setOpen(false)}>
              {value}
            </Button>
          ))}
        </div>
      </ResponsiveDialog>
    </>
  );
}

export const Auto = demo(() => <Example label="Open" />);

export const ForcedDrawer = demo(() => <Example mode="drawer" label="Open as drawer" />);
