import { useState } from "react";
import { SlippageInput } from "@/components/slippage-input";

export default function SlippageInputDemo() {
  const [bps, setBps] = useState(50);
  return (
    <div className="w-full max-w-sm">
      <SlippageInput value={bps} onValueChange={setBps} />
    </div>
  );
}
