// Docs: https://0xui.io/components/shielded-exits.md
import { Loader2Icon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Address, Hash } from "viem";
import { useChains, useConnection, useSendTransaction, useSwitchChain } from "wagmi";
import { ConnectWalletDialog } from "@/components/connect-wallet";
import { MorphText } from "@/components/morph-text";
import { ProofProgress, type ProofPhase } from "@/components/proof-progress";
import { shieldedBalanceMeta, type ShieldedToken } from "@/components/shielded-balance";
import { useShieldedEngine, useShieldedState } from "@/components/shielded-provider";
import { TokenAmount } from "@/components/token-amount";
import { TransactionStatus } from "@/components/transaction-status";
import { Button } from "@/components/ui/button";
import {
  agentConfirmText,
  errorCode,
  isUserRejection,
  truncateAddress,
  type ErrorCode,
} from "@/lib/0xui-utils";
import type { PreparedExit, ProofStage, ShieldedExit } from "@/lib/shielded-engine";
import { cn } from "@/lib/utils";

/**
 * The public exits open to the account on a chain: funds that can go back to
 * the address that shielded them. Undefined until the first scan finishes,
 * and on an engine whose protocol has no such exit.
 */
export function useShieldedExits({ chainId }: { chainId: number }) {
  return useShieldedState("balances", (engine) => engine.getExits?.(chainId), undefined);
}

/** Where one exit is. `ready`: the proof is made and the wallet step waits for a click. */
export type ShieldedExitPhase = "idle" | "proving" | "ready" | "wallet" | "cancelled" | "error";

const toError = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)));

/**
 * Takes one exit in two clicks after it is opened: `prepare` makes the proof and builds the
 * transaction, `send` opens the wallet. They are separate because a wallet
 * prompt has to come straight from a click, and a proof takes seconds.
 */
export function useShieldedExit({
  chainId,
  onSubmitted,
}: {
  chainId: number;
  /** Called with the exit transaction's hash once the wallet has sent it. */
  onSubmitted?: (hash: Hash, exit: ShieldedExit) => void;
}) {
  const engine = useShieldedEngine();
  const sendTransaction = useSendTransaction();
  const [exit, setExit] = useState<ShieldedExit>();
  const [phase, setPhase] = useState<ShieldedExitPhase>("idle");
  const [stage, setStage] = useState<ProofStage>();
  const [problem, setProblem] = useState<{ message: string; code?: ErrorCode; proof: boolean }>();
  const prepared = useRef<PreparedExit>(undefined);
  // The proof in progress. Leaving or unmounting aborts it.
  const current = useRef<AbortController>(undefined);
  useEffect(() => () => current.current?.abort(), []);
  // The latest callback, for a send that finishes after a re-render.
  const submitted = useRef(onSubmitted);
  submitted.current = onSubmitted;

  const leave = () => {
    current.current?.abort();
    current.current = undefined;
    prepared.current = undefined;
    setExit(undefined);
    setPhase("idle");
    setStage(undefined);
    setProblem(undefined);
  };

  const prepare = async (target: ShieldedExit) => {
    current.current?.abort();
    const run = new AbortController();
    current.current = run;
    prepared.current = undefined;
    setExit(target);
    setProblem(undefined);
    setStage("loading-circuits");
    setPhase("proving");
    try {
      const result = await engine.prepareExit!(chainId, target.id, {
        signal: run.signal,
        onStage: (next) => {
          if (current.current === run) setStage(next);
        },
      });
      if (current.current !== run) return;
      prepared.current = result;
      setPhase("ready");
    } catch (cause) {
      if (current.current !== run) return;
      if (run.signal.aborted) return setPhase("cancelled");
      const error = toError(cause);
      setProblem({ message: error.message, code: errorCode("error", error), proof: true });
      setPhase("error");
    }
  };

  const send = async () => {
    const target = exit;
    const transaction = prepared.current?.transaction;
    if (!target || !transaction || phase === "wallet") return;
    setProblem(undefined);
    setPhase("wallet");
    try {
      const hash = await sendTransaction.mutateAsync({ chainId, ...transaction });
      leave();
      submitted.current?.(hash, target);
    } catch (cause) {
      const error = toError(cause);
      if (isUserRejection(error)) return setPhase("cancelled");
      setProblem({
        message: (error as { shortMessage?: string }).shortMessage ?? error.message,
        code: errorCode("error", error),
        proof: false,
      });
      setPhase("error");
    }
  };

  return {
    phase,
    /** The exit in progress. Undefined while none is open. */
    exit,
    /** The proof stage that is running, or the one a failed proof stopped in. */
    stage,
    /** Why it stopped. `proof` says whether the proof failed, or the send. */
    problem: phase === "error" ? problem : undefined,
    /** The transaction is built: `send` will open the wallet. */
    prepared: prepared.current !== undefined,
    /** Open an exit without starting anything, e.g. to show what it means first. */
    open: (target: ShieldedExit) => {
      leave();
      setExit(target);
    },
    /** Make the proof and build the transaction for `exit`. */
    prepare: (target: ShieldedExit) => void prepare(target),
    /** Open the wallet for the prepared exit. One click, one prompt. */
    send: () => void send(),
    /** Stop the proof. */
    cancel: () => current.current?.abort(),
    /** Close the exit. Nothing that was sent is undone. */
    leave,
  };
}

/**
 * Why the wallet can't send the exit yet, or undefined when it can. An exit
 * only works from the address that shielded the funds.
 */
export function shieldedExitBlocker({
  address,
  depositor,
  walletChainId,
  chainId,
  chainName = "the right network",
}: {
  /** Connected wallet address. */
  address: Address | undefined;
  depositor: Address | undefined;
  walletChainId: number | undefined;
  chainId: number;
  chainName?: string;
}): { label: string; action?: "connect" | "switch-chain" } | undefined {
  if (!address) return { label: "Connect wallet", action: "connect" };
  if (depositor && address.toLowerCase() !== depositor.toLowerCase()) {
    return { label: `Switch wallet to ${truncateAddress(depositor)}` };
  }
  if (walletChainId !== chainId) return { label: `Switch to ${chainName}`, action: "switch-chain" };
  return undefined;
}

export type ShieldedExitsProps = {
  chainId: number;
  /** Symbol and decimals for the tokens that may show up. Others are shown by address. */
  tokens: readonly ShieldedToken[];
  /** Called with the exit transaction's hash once the wallet has sent it. */
  onSubmitted?: (hash: Hash, exit: ShieldedExit) => void;
  /** Called when the exit is mined. The component has already asked the engine to scan. */
  onConfirmed?: (hash: Hash) => void;
  /** Heading. Pass null to hide. */
  title?: ReactNode;
  /** Shown when there is nothing to exit. Defaults to rendering nothing at all. */
  empty?: ReactNode;
  className?: string;
};

const proofPhase = (phase: ShieldedExitPhase, stage: ProofStage | undefined): ProofPhase =>
  phase === "proving" ? (stage ?? "loading-circuits") : phase === "idle" ? "idle" : "done";

/**
 * The public way out: each row is funds that can go back to the address
 * that shielded them, whether or not the protocol cleared them for private
 * use. Taking one is public and final, so it opens a warning first, then
 * makes the proof, then asks the wallet, which must be that address.
 * Afterwards it follows the transaction and has the engine scan.
 */
export function ShieldedExits({
  chainId,
  tokens,
  onSubmitted,
  onConfirmed,
  title = "Exit publicly",
  empty,
  className,
}: ShieldedExitsProps) {
  const engine = useShieldedEngine();
  const exits = useShieldedExits({ chainId });
  const connection = useConnection();
  const chains = useChains();
  const switchChain = useSwitchChain();
  const [connectOpen, setConnectOpen] = useState(false);
  /** Exits that were sent, followed until they are mined. */
  const [sent, setSent] = useState<{ hash: Hash; label: string }[]>([]);

  const tokenOf = (address: Address) =>
    tokens.find((token) => token.address.toLowerCase() === address.toLowerCase());
  const flow = useShieldedExit({
    chainId,
    onSubmitted: (hash, exit) => {
      const symbol = tokenOf(exit.token)?.symbol ?? truncateAddress(exit.token);
      setSent((list) => [...list, { hash, label: `Exit ${symbol} publicly` }]);
      onSubmitted?.(hash, exit);
    },
  });

  if (!engine.prepareExit || !exits) return null;
  if (exits.length === 0 && sent.length === 0 && !empty) return null;

  const blockerFor = (exit: ShieldedExit) =>
    shieldedExitBlocker({
      address: connection.address,
      depositor: exit.depositor,
      walletChainId: connection.chainId,
      chainId,
      chainName: chains.find((chain) => chain.id === chainId)?.name,
    });
  const busy = flow.phase === "proving" || flow.phase === "wallet";

  return (
    <div
      data-slot="shielded-exits"
      data-phase={flow.phase}
      data-error={flow.problem?.code ?? errorCode(flow.phase)}
      className={cn("flex w-full max-w-md flex-col gap-3 text-sm", className)}
    >
      {title && <h3 className="text-lg font-semibold">{title}</h3>}
      {exits.length === 0 && empty && <p className="text-muted-foreground">{empty}</p>}

      <ul className="flex flex-col gap-2">
        {exits.map((exit) => {
          const token = tokenOf(exit.token);
          const open = flow.exit?.id === exit.id;
          const blocker = blockerFor(exit);
          const amount = (
            <TokenAmount
              value={exit.amount}
              decimals={token?.decimals ?? 18}
              symbol={token?.symbol ?? truncateAddress(exit.token)}
              maxDecimals={6}
            />
          );

          let label: string;
          let action: (() => void) | undefined;
          if (blocker) {
            label = blocker.label;
            if (blocker.action === "connect") action = () => setConnectOpen(true);
            if (blocker.action === "switch-chain" && !switchChain.isPending) {
              action = () =>
                switchChain.mutate({ chainId: chainId as (typeof chains)[number]["id"] });
            }
          } else if (flow.phase === "proving") {
            label = "Preparing exit…";
          } else if (flow.phase === "wallet") {
            label = "Confirm in wallet…";
          } else if (flow.prepared) {
            label = "Send exit from wallet";
            action = flow.send;
          } else {
            label = flow.phase === "idle" ? "Prepare exit" : "Try again";
            action = () => flow.prepare(exit);
          }

          return (
            <li
              key={exit.id}
              data-state={exit.state}
              data-open={open || undefined}
              className="flex flex-col gap-3 rounded-xl border p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">{amount}</span>
                  <span className="text-muted-foreground">
                    {shieldedBalanceMeta[exit.state].label}
                    {exit.depositor && ` · from ${truncateAddress(exit.depositor)}`}
                  </span>
                </div>
                {!open && (
                  <Button
                    variant="outline"
                    size="sm"
                    // One exit at a time: its proof and wallet step belong together.
                    disabled={flow.exit !== undefined}
                    onClick={() => flow.open(exit)}
                  >
                    Exit publicly
                  </Button>
                )}
              </div>

              {open && (
                <>
                  <p role="note" className="rounded-lg bg-destructive/10 p-3 text-destructive">
                    Public and final. {amount} goes back to{" "}
                    {exit.depositor ? truncateAddress(exit.depositor) : "the address it came from"},
                    and anyone can see it left the private balance.
                    {exit.state === "spendable" && " These funds could be unshielded privately instead."}
                  </p>
                  <ProofProgress
                    phase={
                      flow.problem?.proof
                        ? "error"
                        : flow.phase === "cancelled" && !flow.prepared
                          ? "cancelled"
                          : proofPhase(flow.prepared ? "ready" : flow.phase, flow.stage)
                    }
                    stage={flow.stage}
                    error={flow.problem?.proof ? flow.problem.message : undefined}
                    onCancel={flow.cancel}
                  />
                  <div className="flex flex-col gap-2">
                    <Button
                      className={cn("w-full", busy && "disabled:opacity-100")}
                      disabled={!action || (busy && !blocker)}
                      aria-busy={busy || undefined}
                      onClick={action}
                      data-agent-confirm={
                        action === flow.send
                          ? agentConfirmText(label, "sends these private funds back in public")
                          : undefined
                      }
                    >
                      {busy && !blocker && (
                        <Loader2Icon
                          aria-hidden
                          className="animate-spin motion-reduce:animate-none"
                        />
                      )}
                      <MorphText>{label}</MorphText>
                    </Button>
                    <div className="flex min-h-5 items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span role="status">
                        {flow.phase === "cancelled" && flow.prepared ? "Cancelled in wallet." : ""}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-50"
                        disabled={flow.phase === "wallet"}
                        onClick={flow.leave}
                      >
                        Close
                      </button>
                    </div>
                    {flow.problem && !flow.problem.proof && (
                      <p role="alert" className="text-destructive">
                        {flow.problem.message}
                      </p>
                    )}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>

      {sent.map(({ hash, label }) => (
        <TransactionStatus
          key={hash}
          hash={hash}
          chainId={chainId}
          onConfirmed={() => {
            // The private balance only changes once a scan sees the exit.
            void engine.sync(chainId);
            onConfirmed?.(hash);
          }}
        >
          {label}
        </TransactionStatus>
      ))}
      <ConnectWalletDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </div>
  );
}
