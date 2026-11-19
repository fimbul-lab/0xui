import { useState } from "react";
import { parseUnits } from "viem";
import { AmountInput } from "@/components/amount-input";

const balance = parseUnits("1250.5", 6);

export default function AmountInputDemo() {
  const [value, setValue] = useState("");
  const [exceedsMax, setExceedsMax] = useState(false);
  return (
    <div className="w-full max-w-xs">
      <AmountInput
        value={value}
        onValueChange={(next, state) => {
          setValue(next);
          setExceedsMax(state.exceedsMax);
        }}
        decimals={6}
        max={balance}
        hint={exceedsMax ? "More than your 1,250.5 USDC" : "Up to 6 decimals, like USDC"}
      />
    </div>
  );
}
