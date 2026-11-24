import { useState } from "react";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { Button } from "@/components/primitives/button";

export default function ResponsiveDialogDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Slippage
      </Button>
      <ResponsiveDialog
        open={open}
        onOpenChange={setOpen}
        title="Slippage"
        description="Choose how much the price may move before the swap is cancelled."
        className="sm:data-[presentation=dialog]:max-w-sm"
      >
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
