import { useState } from "react";
import { parseUnits } from "viem";
import { AmountInput, type AmountState } from "@/components/amount-input";
import { demo } from "./demo";

export const Default = demo(function AmountDemo() {
  const [value, setValue] = useState("");
  const [state, setState] = useState<AmountState>();
  return (
    <div className="w-full max-w-xs">
      <AmountInput
        value={value}
        onValueChange={(next, s) => {
          setValue(next);
          setState(s);
        }}
        decimals={6}
        max={parseUnits("1250.5", 6)}
        hint={state?.exceedsMax ? "More than your 1,250.5 USDC" : "Up to 6 decimals, like USDC"}
      />
    </div>
  );
});
