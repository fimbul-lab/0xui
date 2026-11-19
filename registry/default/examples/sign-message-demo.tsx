import { SignMessage } from "@/components/sign-message";

export default function SignMessageDemo() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <SignMessage
        message={
          "Sign in to Example\n\nThis request will not trigger a transaction or cost any gas."
        }
        verify
        showMessage
        showSignature
      >
        Sign in
      </SignMessage>
      <SignMessage
        typedData={{
          domain: { name: "Example", version: "1", chainId: 1 },
          types: {
            Order: [
              { name: "amount", type: "uint256" },
              { name: "token", type: "string" },
            ],
          },
          primaryType: "Order",
          message: { amount: 100n, token: "USDC" },
        }}
        showMessage
      >
        Sign order
      </SignMessage>
    </div>
  );
}
