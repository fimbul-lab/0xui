import { SignMessage } from "@/components/sign-message";
import { demo } from "./demo";

export const Default = demo(() => (
  <SignMessage
    message={"Sign in to 0xui docs\n\nThis request will not trigger a transaction or cost any gas."}
    showMessage
    showSignature
    className="w-full max-w-sm"
  >
    Sign in
  </SignMessage>
));

export const TypedData = demo(() => (
  <SignMessage
    typedData={{
      domain: { name: "0xui", version: "1", chainId: 1 },
      types: { Order: [{ name: "amount", type: "uint256" }, { name: "token", type: "string" }] },
      primaryType: "Order",
      message: { amount: 100n, token: "USDC" },
    }}
    showMessage
    showSignature
    className="w-full max-w-sm"
  >
    Sign order
  </SignMessage>
));
