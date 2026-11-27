// Locale pinned so the server and the browser format numbers the same way.
import { useState } from "react";
import { SlippageInput } from "@/components/slippage-input";
import { demo } from "./demo";

export const Default = demo(() => {
  const [bps, setBps] = useState(50);
  return (
    <div className="w-full max-w-sm">
      <SlippageInput locale="en-US" value={bps} onValueChange={setBps} />
    </div>
  );
});

export const Warning = demo(() => {
  const [bps, setBps] = useState(800);
  return (
    <div className="w-full max-w-sm">
      <SlippageInput locale="en-US" value={bps} onValueChange={setBps} />
    </div>
  );
});
