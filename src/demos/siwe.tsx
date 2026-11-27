import { useMemo, useState } from "react";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import { useConnection } from "wagmi";
import { SignMessage } from "@/components/sign-message";
import { demo } from "./demo";

export const SignIn = demo(() => {
  const { address, chainId } = useConnection();
  // A real app gets the nonce from its server. See the guide.
  const [nonce] = useState(generateSiweNonce);
  const message = useMemo(
    () =>
      address && chainId
        ? createSiweMessage({
            address,
            chainId,
            domain: window.location.host,
            uri: window.location.origin,
            nonce,
            version: "1",
            statement: "Sign in to the 0xui docs. This won't cost any gas.",
          })
        : "",
    [address, chainId, nonce],
  );

  return (
    <SignMessage message={message} showMessage showSignature className="w-full max-w-sm">
      Sign in
    </SignMessage>
  );
});
