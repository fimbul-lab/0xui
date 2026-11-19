// Docs: https://0xui.io/components/sign-message.md
import { CheckIcon, Loader2Icon } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import type { Hex, SignableMessage, TypedDataDefinition } from "viem";
import { useConnection, usePublicClient, useSignMessage, useSignTypedData } from "wagmi";
import { ConnectWalletDialog } from "@/components/connect-wallet";
import { CopyButton } from "@/components/copy-button";
import { MorphText } from "@/components/morph-text";
import { Button } from "@/components/ui/button";
import { agentConfirmText, errorCode, isUserRejection, truncateAddress } from "@/lib/0xui-utils";
import { cn } from "@/lib/utils";

export type SignPhase =
  | "idle"
  | "signing"
  | "verifying"
  | "signed"
  | "invalid"
  | "cancelled"
  | "error";

export type SignRequest =
  | { message: SignableMessage; typedData?: never }
  | { typedData: TypedDataDefinition; message?: never };

/**
 * Sign a message (EIP-191) or typed data (EIP-712) with the connected
 * wallet, and optionally verify the signature. Verification goes through
 * the RPC, so smart-contract wallets (ERC-1271/6492) verify too.
 */
export function useSignFlow(
  request: SignRequest,
  { verify = false, onSigned }: { verify?: boolean; onSigned?: (signature: Hex) => void } = {},
) {
  const { address } = useConnection();
  const client = usePublicClient();
  const signMessage = useSignMessage();
  const signTypedData = useSignTypedData();
  const [phase, setPhase] = useState<SignPhase>("idle");
  const [signature, setSignature] = useState<Hex>();
  const [error, setError] = useState<Error>();

  const sign = async () => {
    if (!address) return;
    setError(undefined);
    setSignature(undefined);
    setPhase("signing");
    try {
      const sig = request.typedData
        ? await signTypedData.mutateAsync(request.typedData)
        : await signMessage.mutateAsync({ message: request.message! });
      setSignature(sig);
      onSigned?.(sig);
      if (verify && client) {
        setPhase("verifying");
        const valid = request.typedData
          ? await client.verifyTypedData({ ...request.typedData, address, signature: sig })
          : await client.verifyMessage({ address, signature: sig, message: request.message! });
        setPhase(valid ? "signed" : "invalid");
      } else {
        setPhase("signed");
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      setPhase(isUserRejection(err) ? "cancelled" : "error");
    }
  };

  const reset = () => {
    setPhase("idle");
    setSignature(undefined);
    setError(undefined);
  };

  return { phase, signature, error, sign, reset, isConnected: Boolean(address) };
}

export type SignMessageProps = Omit<ComponentProps<typeof Button>, "onClick" | "children"> &
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
     * `false` to drop it.
     */
    agentConfirm?: string | false;
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
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        onClick={flow.isConnected ? flow.sign : () => setConnectOpen(true)}
        data-agent-confirm={
          agentConfirm === false
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
