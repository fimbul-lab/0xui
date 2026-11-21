// Docs: https://0xui.io/components/shielded-exits.md
import { Loader2Icon } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import type { Address, Hash } from "viem";
import { useConfig } from "wagmi";
import { ConnectWalletDialog } from "@/components/connect-wallet";
import { MorphText } from "@/components/morph-text";
import { Button } from "@/components/primitives/button";
import { ProofProgress } from "@/components/proof-progress";
import { shieldedBalanceMeta, type ShieldedToken } from "@/components/shielded-balance";
import { useShieldedClient, useShieldedEngine, useShieldedStore } from "@/components/shielded-provider";
import { TokenAmount } from "@/components/token-amount";
import { TransactionStatus } from "@/components/transaction-status";
import { useStore } from "@/hooks/use-store";
import { errorCode, truncateAddress } from "@/lib/0xui-utils";
import type { ShieldedExit } from "@/lib/shielded-engine";
import {
  createShieldedExitFlow,
  exitProofPhase,
  selectShieldedExits,
  shieldedExitAction,
  shieldedExitBlocker,
  shieldedExitConfirmText,
} from "@/lib/shielded-exits-core";
import { cn } from "@/lib/utils";

export {
  createShieldedExitFlow,
  shieldedExitBlocker,
  shieldedExitConfirmText,
  type ShieldedExitPhase,
} from "@/lib/shielded-exits-core";

/**
 * The public exits open to the account on a chain: funds that can go back to
 * the address that shielded them. Undefined until the first scan finishes,
 * and on an engine whose protocol has no such exit.
 */
export function useShieldedExits({ chainId }: { chainId: number }) {
  const client = useShieldedClient();
  const store = useMemo(() => selectShieldedExits(client, chainId), [client, chainId]);
  return useShieldedStore(store, undefined);
}

/**
 * Takes one exit in two clicks after it is opened: `prepare` makes the proof
 * and builds the transaction, `send` opens the wallet. The logic lives in
 * `createShieldedExitFlow` (framework-free).
 */
export function useShieldedExit({
  chainId,
  onSubmitted,
}: {
  chainId: number;
  /** Called with the exit transaction's hash once the wallet has sent it. */
  onSubmitted?: (hash: Hash, exit: ShieldedExit) => void;
}) {
  const config = useConfig();
  const engine = useShieldedEngine();
  // The latest callback, for a send that finishes after a re-render.
  const submitted = useRef(onSubmitted);
  submitted.current = onSubmitted;
  const controller = useMemo(
    () =>
      createShieldedExitFlow(config, engine, {
        chainId,
        onSubmitted: (hash, exit) => submitted.current?.(hash, exit),
      }),
    [config, engine, chainId],
  );
  const state = useStore(controller);
  return {
    phase: state.phase,
    /** The exit in progress. Undefined while none is open. */
    exit: state.exit,
    /** The proof stage that is running, or the one a failed proof stopped in. */
    stage: state.stage,
    /** Why it stopped. `proof` says whether the proof failed, or the send. */
    problem: state.phase === "error" ? state.problem : undefined,
    /** The transaction is built: `send` will open the wallet. */
    prepared: state.prepared !== undefined,
    /** The connected wallet and its chain. */
    wallet: { address: state.address, chainId: state.walletChainId },
    /** A network switch is waiting on the wallet. */
    switching: state.switching,
    open: controller.open,
    prepare: controller.prepare,
    send: controller.send,
    cancel: controller.cancel,
    leave: controller.leave,
    switchChain: controller.switchChain,
  };
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
  const { chains } = useConfig();
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
      address: flow.wallet.address,
      depositor: exit.depositor,
      walletChainId: flow.wallet.chainId,
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

          const { label, action: kind } = shieldedExitAction({
            blocker,
            phase: flow.phase,
            prepared: flow.prepared,
            switching: flow.switching,
          });
          const action =
            kind === "connect"
              ? () => setConnectOpen(true)
              : kind === "switch-chain"
                ? () => void flow.switchChain()
                : kind === "send"
                  ? flow.send
                  : kind === "prepare"
                    ? () => flow.prepare(exit)
                    : undefined;

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
                    phase={exitProofPhase(flow)}
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
                        kind === "send" ? shieldedExitConfirmText({ exit, token }) : undefined
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
                      <Button
                        variant="ghost"
                        size="xs"
                        className="shrink-0 text-xs"
                        disabled={flow.phase === "wallet"}
                        onClick={flow.leave}
                      >
                        Close
                      </Button>
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
