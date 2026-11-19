import { useState } from "react";
import type { Address } from "viem";
import { AddressInput } from "@/components/address-input";

export default function AddressInputDemo() {
  const [text, setText] = useState("");
  const [recipient, setRecipient] = useState<Address>();
  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      <AddressInput
        value={text}
        onValueChange={setText}
        onResolve={(state) => setRecipient(state.address)}
      />
      <p className="text-xs text-muted-foreground">
        {recipient ? (
          <>
            Sending to <code>{recipient}</code>
          </>
        ) : (
          <>
            Try <code>vitalik.eth</code> or paste an address.
          </>
        )}
      </p>
    </div>
  );
}
