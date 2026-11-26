// Docs: https://0xui.io/components/sign-message.md
import { CheckIcon, Loader2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import type { Hex } from "viem";
import { useConfig } from "wagmi";
import { ConnectWalletDialog } from "@/components/connect-wallet";
import { CopyButton } from "@/components/copy-button";
import { MorphText } from "@/components/morph-text";
import { Button } from "@/components/primitives/button";
import { useStore } from "@/hooks/use-store";
import { agentConfirmText, errorCode, truncateAddress } from "@/lib/0xui-utils";
import { createMessageSigner } from "@/lib/sign-message-core";
import type { SignPhase, SignRequest } from "@/lib/sign-message-core";
import { cn } from "@/lib/utils";

export type { SignPhase, SignRequest };

/**
 * Sign a message (EIP-191) or typed data (EIP-712) with the connected
 * wallet, and optionally verify the signature. The logic lives in
 * `createMessageSigner` (framework-free); this only renders it.
 */
export function useSignFlow(
  request: SignRequest,
  { verify = false, onSigned }: { verify?: boolean; onSigned?: (signature: Hex) => void } = {},
) {
  const config = useConfig();
  const signer = useMemo(() => createMessageSigner(config), [config]);
  const { phase, signature, error, address } = useStore(signer);

  return {
    phase,
    signature,
    error,
    sign: () => signer.sign(request, { verify, onSigned }),
    reset: signer.reset,
    isConnected: Boolean(address),
  };
}

export type SignMessageProps = Omit<
  ComponentProps<typeof Button>,
  "onClick" | "children" | "className"
> &
  SignRequest & {
    /** Check the signature against the connected address after signing. */
    verify?: boolean;
    /** Called with the signature. */
    onSigned?: (signature: Hex) => void;
    /** Show the message being signed above the button. */
    showMessage?: boolean;
    /** Show the signature with a copy button after signing. */
    showSignature?: boolean;
    children?: ReactNode;
    /**
     * What a browser agent must ask a person before pressing the button, set
     * as `data-agent-confirm`. Defaults to the label plus what it does. Pass
     * `false` to drop it. Not set while the button opens the wallet picker.
     */
    agentConfirm?: string | false;
    className?: string;
  };

const statusText: Partial<Record<SignPhase, string>> = {
  signing: "Sign the message in your wallet.",
  verifying: "Checking the signature…",
  signed: "Signed.",
  cancelled: "Cancelled in wallet.",
};

/**
 * Button that asks the wallet to sign a message or typed data. Opens the
 * wallet picker when disconnected, labels each step, and can verify and
 * show the signature.
 */
export function SignMessage({
  message,
  typedData,
  verify = false,
  onSigned,
  showMessage = false,
  showSignature = false,
  children = "Sign message",
  agentConfirm,
  className,
  disabled,
  ...buttonProps
}: SignMessageProps) {
  const [connectOpen, setConnectOpen] = useState(false);
  const request = (typedData ? { typedData } : { message }) as SignRequest;
  const flow = useSignFlow(request, { verify, onSigned });
  const busy = flow.phase === "signing" || flow.phase === "verifying";

  const label = !flow.isConnected
    ? "Connect wallet"
    : flow.phase === "signing"
      ? "Sign in wallet…"
      : flow.phase === "verifying"
        ? "Verifying…"
        : flow.phase === "signed"
          ? verify
            ? "Signature verified"
            : "Signed"
          : children;

  const preview =
    typeof message === "string"
      ? message
      : typedData
        ? JSON.stringify(typedData.message, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)
        : undefined;

  return (
    <div
      data-slot="sign-message"
      data-phase={flow.phase}
      data-error={errorCode(flow.phase, flow.error)}
      className={cn("inline-flex flex-col gap-2", className)}
    >
      {showMessage && preview && (
        <pre className="max-h-40 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
          {preview}
        </pre>
      )}
      <Button
        {...buttonProps}
        disabled={disabled}
        onClick={flow.isConnected ? flow.sign : () => setConnectOpen(true)}
        data-agent-confirm={
          // Disconnected, it only opens the wallet picker, which asks per wallet.
          agentConfirm === false || !flow.isConnected
            ? undefined
            : (agentConfirm ??
              agentConfirmText(
                children,
                typedData
                  ? "signs typed data with your wallet"
                  : "signs a message with your wallet",
              ))
        }
      >
        {busy && <Loader2Icon aria-hidden className="animate-spin" />}
        {flow.phase === "signed" && <CheckIcon aria-hidden />}
        <MorphText>{label}</MorphText>
      </Button>
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {statusText[flow.phase] ?? ""}
      </p>
      {flow.phase === "invalid" && (
        <p role="alert" className="text-sm text-destructive">
          The signature doesn't match the connected address.
        </p>
      )}
      {flow.phase === "error" && flow.error && (
        <p role="alert" className="text-sm text-destructive">
          {(flow.error as { shortMessage?: string }).shortMessage ?? flow.error.message}
        </p>
      )}
      {showSignature && flow.signature && (
        <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
          {truncateAddress(flow.signature, { start: 10, end: 8 })}
          <CopyButton value={flow.signature} label="Copy signature" />
        </span>
      )}
      <ConnectWalletDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </div>
  );
}
