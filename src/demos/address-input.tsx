import { useState } from "react";
import { AddressInput } from "@/components/address-input";
import type { AddressInputState } from "@/components/address-input";
import { demo } from "./demo";

export const Default = demo(function AddressInputDemo() {
  const [value, setValue] = useState("");
  const [state, setState] = useState<AddressInputState>();
  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      <AddressInput value={value} onValueChange={setValue} onResolve={setState} />
      <p className="text-xs text-muted-foreground">
        Try <code>vitalik.eth</code>, a pasted address, or flip the case of one letter.
        {state?.phase === "valid" && (
          <>
            {" "}
            Resolved: <code>{state.address}</code>
          </>
        )}
      </p>
    </div>
  );
});

export const Shielded = demo(function ShieldedAddressInputDemo() {
  const [value, setValue] = useState("");
  const [state, setState] = useState<AddressInputState>();
  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      <AddressInput value={value} onValueChange={setValue} onResolve={setState} shielded />
      <p className="text-xs text-muted-foreground">
        Paste a <code>0zk</code> address, then change one character.
        {state?.shieldedAddress && <> Private recipient accepted.</>}
        {state?.address && <> Public recipient accepted.</>}
      </p>
      <button
        type="button"
        className="self-start text-xs underline underline-offset-4"
        onClick={() =>
          setValue(
            "0zk1qyqqqqdl645pcpreh6dga7xa3w4dm9c3tzv6ntesk0fy2kzr476pkumpd9kxwatw8qqqqqdl645pcpreh6dga7xa3w4dm9c3tzv6ntesk0fy2kzr476pkwrfm4m",
          )
        }
      >
        Fill in an example
      </button>
    </div>
  );
});
