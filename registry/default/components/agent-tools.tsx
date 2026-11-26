// Docs: https://0xui.io/components/agent-tools.md
import { createAgent } from "@ui-sdk/react/agent";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useConfig } from "wagmi";
import {
  agentPermissions,
  pageAgentTools,
  registerAgentTools,
  walletAgentTools,
} from "@/lib/agent-tools-core";
import type {
  Agent,
  AgentConfirm,
  AgentTool,
  RegisterAgentToolsOptions,
  WalletAgentToolsOptions,
} from "@/lib/agent-tools-core";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  createAlertDialogController,
} from "@/components/primitives/alert-dialog";
import { Button } from "@/components/primitives/button";

export {
  agentPermissions,
  pageAgentTools,
  registerAgentTools,
  walletAgentTools,
  type Agent,
  type AgentConfirm,
  type AgentTool,
  type RegisterAgentToolsOptions,
  type WalletAgentToolsOptions,
};

// One bridge and one place to ask per page, however many AgentTools render:
// the first one mounted registers the tools and asks the person.
type Instance = { confirm: () => AgentConfirm | false };
let instances: Array<Instance> = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const setInstances = (next: Array<Instance>) => {
  instances = next;
  for (const listener of listeners) {
    listener();
  }
};

/**
 * Asks the person through the mounted `AgentTools`' confirm, the dialog by
 * default. Resolves `false` when none is mounted or its `confirm` is `false`.
 * Pass it as `confirm` to `walletAgentTools` in your own model loop.
 */
export const askPerson: AgentConfirm = (message, options) => {
  const confirm = instances[0]?.confirm();
  return confirm ? confirm(message, options) : false;
};

const permissions = agentPermissions(askPerson);
let agent: Agent | undefined;

/**
 * The page's ui-sdk agent bridge, created on first call. Steps on a
 * `data-agent-confirm` control go to `askPerson`; everything else runs.
 * Browser only: call it from an effect or an event handler.
 */
export function getAgent(): Agent {
  if (typeof document === "undefined") {
    throw new Error("getAgent() runs in the browser. Call it from an effect or an event handler.");
  }
  return (agent ??= createAgent({ allow: permissions.allow }));
}

export type UseAgentToolsOptions = {
  /** Your own tools, registered next to the wallet tools. */
  tools?: Array<AgentTool>;
  /** Set to false to register nothing, e.g. until the person opts in. */
  enabled?: boolean;
  /**
   * Asks the person before an agent's step on a `data-agent-confirm` control,
   * or a wallet tool that opens the wallet. `false` refuses those steps.
   * `useAgentTools` alone has no dialog, so it defaults to `false`.
   */
  confirm?: AgentConfirm | false;
};

const noTools: Array<AgentTool> = [];

/**
 * Registers ui-sdk's `snapshot`, `act` and `query` for the page and the
 * wallet tools, plus any of your own, while the component is mounted. A new
 * `tools` array registers everything again, so keep it stable.
 */
export function useAgentTools({
  tools = noTools,
  enabled = true,
  confirm = false,
}: UseAgentToolsOptions = {}) {
  const config = useConfig();
  const confirmRef = useRef(confirm);
  useEffect(() => {
    confirmRef.current = confirm;
  });
  const [instance] = useState<Instance>(() => ({ confirm: () => confirmRef.current }));
  const owner = useSyncExternalStore(
    subscribe,
    () => instances[0] === instance,
    () => false,
  );

  useEffect(() => {
    setInstances([...instances, instance]);
    return () => setInstances(instances.filter((other) => other !== instance));
  }, [instance]);

  useEffect(() => {
    // Without WebMCP there is nothing to register, so don't start the bridge for it.
    if (!owner || !enabled || !("modelContext" in document)) {
      return;
    }
    return registerAgentTools([...walletAgentTools(config, { confirm: askPerson }), ...tools], {
      agent: getAgent(),
      allow: permissions.approved,
    });
  }, [owner, enabled, config, tools]);
}

/** One question at a time, in an alert dialog the agent can't see or press. */
function createDialogConfirm() {
  const controller = createAlertDialogController<string>();
  let queue: Promise<unknown> = Promise.resolve();
  const confirm: AgentConfirm = (message, { signal }) => {
    const answer = queue.then(async () => {
      if (signal.aborted) {
        return false;
      }
      const result = await controller.open({ payload: message, signal });
      return result.returnValue === "confirm";
    });
    queue = answer.catch(() => {});
    return answer;
  };
  return { controller, confirm };
}

function AgentConfirmDialog({
  controller,
}: {
  controller: ReturnType<typeof createAlertDialogController<string>>;
}) {
  return (
    <AlertDialog controller={controller}>
      {/* Hidden from agents, so one can't answer its own question. */}
      <AlertDialogContent data-slot="agent-confirm" data-agent-hidden="">
        {(state) => (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Allow the AI agent to do this?</AlertDialogTitle>
              <AlertDialogDescription className="text-foreground">
                {String(state.payload ?? "")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <p className="text-muted-foreground">
              An AI agent using this page asked to do this for you. Nothing happens unless you allow
              it.
            </p>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" />}>Don't allow</AlertDialogClose>
              <AlertDialogClose value="confirm" render={<Button />}>
                Allow
              </AlertDialogClose>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

export type AgentToolsProps = Omit<UseAgentToolsOptions, "confirm"> & {
  /**
   * Asks the person before an agent's step on a `data-agent-confirm` control,
   * or a wallet tool that opens the wallet. Defaults to an alert dialog with
   * the mark's sentence, "Don't allow" and "Allow". `false` refuses them all.
   */
  confirm?: AgentConfirm | false;
};

/**
 * Connects AI agents to the page: ui-sdk's agent bridge (`snapshot`, `act`,
 * `query`) and the wallet tools, registered with the browser through WebMCP.
 * Steps on controls marked `data-agent-confirm`, like Send or Connect, wait
 * for the person in a dialog. Render it once, inside your `Web3Provider`.
 */
export function AgentTools({ confirm, ...options }: AgentToolsProps) {
  const [dialog] = useState(createDialogConfirm);
  useAgentTools({ ...options, confirm: confirm === undefined ? dialog.confirm : confirm });
  return confirm === undefined ? <AgentConfirmDialog controller={dialog.controller} /> : null;
}
