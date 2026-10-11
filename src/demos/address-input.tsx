import { useState } from "react";
import { AddressInput, type AddressInputState } from "@/components/address-input";
import { demo } from "./demo";

export const Default = demo(function AddressInputDemo() {
  const [value, setValue] = useState("");
  const [state, setState] = useState<AddressInputState>();
  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      <AddressInput value={value} onValueChange={setValue} onResolve={setState} />
      <p className="text-xs text-muted-foreground">
        Try <code>vitalik.eth</code>, a pasted address, or flip the case of one letter.
        {state?.phase === "valid" && <> Resolved: <code>{state.address}</code></>}
      </p>
    </div>
  );
});
