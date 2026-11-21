// Docs: https://0xui.io/components/privacy-pools-engine.md
import type {
  AccountService,
  DepositEvent,
  PoolAccount,
  PoolInfo,
  RagequitEvent,
  WithdrawalEvent,
} from "@0xbow/privacy-pools-core-sdk";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  parseAbi,
  type Address,
  type Hash,
} from "viem";
import { english, generateMnemonic } from "viem/accounts";
import {
  SHIELDED_BALANCE_STATES,
  type ShieldedAccountStatus,
  type ShieldedBalanceState,
  type ShieldedEngine,
  type ShieldedEvent,
  type ShieldedSync,
  type ShieldedSyncStage,
  type ShieldedTokenBalance,
  type ShieldedTransaction,
} from "@/lib/shielded-engine";

/** How Privacy Pools names native currency as a pool asset. */
export const PRIVACY_POOLS_NATIVE: Address = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/** One asset's pool on a chain. */
export type PrivacyPoolsPool = {
  /** The pool's asset: an ERC-20 contract, or `PRIVACY_POOLS_NATIVE`. */
  asset: Address;
  /** Block the pool was deployed in. Scanning starts here. */
  deploymentBlock: bigint;
};

/** Privacy Pools on one chain. */
export type PrivacyPoolsChain = {
  /**
   * RPC the engine scans through. A scan reads every pool event since
   * deployment with `eth_getLogs`, so use a provider that allows that.
   */
  rpcUrl: string;
  /** The Entrypoint contract: where deposits go, and the spender to approve. */
  entrypoint: Address;
  /** The ASP's API. It says which deposits are approved. */
  aspUrl: string;
  /** Pools to scan and offer. */
  pools: readonly PrivacyPoolsPool[];
  /** Blocks per `eth_getLogs` request. Halved on its own when the RPC refuses a range. Default 10,000. */
  blockRange?: number;
};

/** Privacy Pools v1 on Sepolia: ETH, USDC and USDT. Bring your own `rpcUrl`. */
export const PRIVACY_POOLS_SEPOLIA = {
  entrypoint: "0x34A2068192b1297f2a7f85D7D8CdE66F8F0921cB",
  aspUrl: "https://dw.0xbow.io",
  pools: [
    { asset: PRIVACY_POOLS_NATIVE, deploymentBlock: 8587019n },
    { asset: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", deploymentBlock: 8587019n },
    { asset: "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0", deploymentBlock: 8587019n },
  ],
} as const satisfies Omit<PrivacyPoolsChain, "rpcUrl">;

/** Where the encrypted recovery phrase is kept. `localStorage` fits. */
export type PrivacyPoolsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A decoded pool event, as viem's `getLogs` returns it. */
type PoolLog = {
  address: Address;
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint | null;
  transactionHash: Hash | null;
  logIndex: number | null;
};

/** The chain reads the engine makes. viem's PublicClient fits. */
export type PrivacyPoolsClient = {
  getBlockNumber(): Promise<bigint>;
  getLogs(args: {
    address: Address[];
    events: typeof POOL_EVENTS;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<unknown[]>;
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
};

export type PrivacyPoolsEngineOptions = {
  /** Privacy Pools deployments, by chain id. */
  chains: Record<number, PrivacyPoolsChain>;
  /**
   * Where the recovery phrase is kept, encrypted with the password. Defaults
   * to `localStorage`, or memory where there is none.
   */
  storage?: PrivacyPoolsStorage;
  /**
   * Seconds a deposit usually waits for the ASP. It is an estimate shown in
   * the quote, not a protocol rule: review often takes under an hour and can
   * take days. Default 3600.
   */
  reviewTime?: number;
  /** Ms between scans while unlocked, so approvals show up. 0 turns it off. Default 60,000. */
  pollInterval?: number;
  /** Chain reads. Defaults to a viem client on the chain's `rpcUrl`. */
  client?: (chainId: number) => PrivacyPoolsClient;
  /** HTTP for the ASP. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
};

const ENTRYPOINT_ABI = parseAbi([
  "function deposit(uint256 _precommitment) payable returns (uint256 _commitment)",
  "function deposit(address _asset, uint256 _value, uint256 _precommitment) returns (uint256 _commitment)",
  "function assetConfig(address _asset) view returns (address pool, uint256 minimumDepositAmount, uint256 vettingFeeBPS, uint256 maxRelayFeeBPS)",
]);

const POOL_ABI = parseAbi(["function SCOPE() view returns (uint256)"]);

// The last Deposited field is the precommitment hash. The name is the SDK's.
const POOL_EVENTS = parseAbi([
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _merkleRoot)",
  "event Withdrawn(address indexed _processooor, uint256 _value, uint256 _spentNullifier, uint256 _newCommitment)",
  "event Ragequit(address indexed _ragequitter, uint256 _commitment, uint256 _label, uint256 _value)",
]);

const ACCOUNT_KEY = "0xui.privacy-pools.account";
const RESERVED_KEY = "0xui.privacy-pools.reserved";

/** Blocks behind the head that are treated as final. Newer events are read again on every scan. */
const REORG_DEPTH = 64n;

/**
 * How long a deposit index stays set aside for a shield that was prepared
 * but not yet seen on chain.
 */
const RESERVATION_LIFETIME = 30 * 60_000;

/**
 * The SDK stops looking for deposits after 10 unused indexes in a row, so
 * the engine never runs further ahead of the chain than this.
 */
const MAX_INDEXES_AHEAD = 8n;

/** `eth_getLogs` requests in flight at once during a scan. */
const LOG_REQUESTS = 3;

const PBKDF2_ROUNDS = 600_000;

const IDLE: ShieldedSync = Object.freeze({ stage: "notes", status: "idle", progress: 0 });

const lower = (value: string) => value.toLowerCase();
const isNative = (asset: Address) => lower(asset) === lower(PRIVACY_POOLS_NATIVE);

/** One line saying why. viem's full message carries the whole request. */
function reason(cause: unknown) {
  const { details, shortMessage, message } = cause as {
    details?: string;
    shortMessage?: string;
    message?: string;
  };
  return details || shortMessage || message || String(cause);
}

/**
 * Where a pool account's funds are, or undefined when it holds nothing: it
 * was withdrawn in full, exited or migrated. `approved` is the ASP's set of
 * approved labels, as decimal strings.
 *
 * A declined deposit reads as `pending`: the ASP publishes approvals in
 * bulk, but a decline can only be asked about one deposit at a time, which
 * would tell the ASP which deposits are yours.
 */
export function poolAccountState(
  account: Pick<PoolAccount, "label" | "deposit" | "children" | "ragequit" | "isMigrated">,
  approved: ReadonlySet<string>
): ShieldedBalanceState | undefined {
  if (account.ragequit || account.isMigrated) return undefined;
  const latest = account.children.at(-1) ?? account.deposit;
  if (latest.value === 0n) return undefined;
  return approved.has(account.label.toString()) ? "spendable" : "pending";
}

/**
 * The next unused deposit index for a pool, from its reconstructed
 * accounts. Indexes of failed deposits stay unused: an index is never
 * handed out twice.
 */
export function nextDepositIndex(
  accounts: readonly Pick<PoolAccount, "depositIndex" | "isMigrationDerived">[]
) {
  let highest = -1n;
  let derived = 0n;
  for (const account of accounts) {
    if (account.isMigrationDerived) continue;
    derived++;
    if (account.depositIndex !== undefined && account.depositIndex > highest) {
      highest = account.depositIndex;
    }
  }
  return highest >= 0n ? highest + 1n : derived;
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

async function passwordKey(password: string, salt: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ROUNDS },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Encrypt a recovery phrase with a password: PBKDF2-SHA256 into AES-256-GCM. */
export async function encryptPhrase(mnemonic: string, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await passwordKey(password, salt),
    new TextEncoder().encode(mnemonic)
  );
  return JSON.stringify({
    v: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(data)),
  });
}

/** Decrypt what `encryptPhrase` made. Rejects with "Wrong password." */
export async function decryptPhrase(stored: string, password: string) {
  try {
    const { salt, iv, data } = JSON.parse(stored) as { salt: string; iv: string; data: string };
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(iv) },
      await passwordKey(password, fromBase64(salt)),
      fromBase64(data)
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("Wrong password.");
  }
}

function memoryStorage(): PrivacyPoolsStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

function defaultStorage(): PrivacyPoolsStorage {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // Blocked, as in a sandboxed frame. Memory keeps the session working.
  }
  return memoryStorage();
}

type Pool = {
  asset: Address;
  address: Address;
  scope: bigint;
  decimals: number;
  deploymentBlock: bigint;
  minimum: bigint;
  feeBps: bigint;
};

type PoolEvents = {
  deposits: DepositEvent[];
  withdrawals: WithdrawalEvent[];
  ragequits: RagequitEvent[];
};

type ChainState = {
  sync: ShieldedSync;
  balances: readonly ShieldedTokenBalance[] | undefined;
  /** Shields the last scan found, by lower-case hash. */
  transactions: Map<string, ShieldedTransaction>;
  scan: Promise<void> | undefined;
  pools: Promise<Pool[]> | undefined;
  /** Final events, by lower-case pool address, read up to `syncedTo`. */
  events: Map<string, PoolEvents>;
  syncedTo: bigint | undefined;
  /** The account as the last complete scan rebuilt it. */
  account: AccountService | undefined;
};

type Reservation = { key: string; index: string; at: number };

const emptyEvents = (): PoolEvents => ({ deposits: [], withdrawals: [], ragequits: [] });

/** Turn decoded logs into the SDK's event shapes, grouped by pool. */
function addLogs(target: Map<string, PoolEvents>, logs: readonly PoolLog[]) {
  for (const log of logs) {
    if (log.blockNumber === null || log.transactionHash === null) continue;
    const key = lower(log.address);
    let events = target.get(key);
    if (!events) target.set(key, (events = emptyEvents()));
    const at = { blockNumber: log.blockNumber, transactionHash: log.transactionHash };
    const args = log.args as Record<string, bigint> & Record<string, string>;
    if (log.eventName === "Deposited") {
      events.deposits.push({
        ...at,
        depositor: lower(args._depositor!),
        commitment: args._commitment,
        label: args._label,
        value: args._value ?? 0n,
        precommitment: args._merkleRoot,
        logIndex: log.logIndex ?? undefined,
      } as DepositEvent);
    } else if (log.eventName === "Withdrawn") {
      events.withdrawals.push({
        ...at,
        withdrawn: args._value ?? 0n,
        spentNullifier: args._spentNullifier,
        newCommitment: args._newCommitment,
      } as WithdrawalEvent);
    } else if (log.eventName === "Ragequit") {
      events.ragequits.push({
        ...at,
        ragequitter: lower(args._ragequitter!),
        commitment: args._commitment,
        label: args._label,
        value: args._value ?? 0n,
      } as RagequitEvent);
    }
  }
}

function sameBalances(a: readonly ShieldedTokenBalance[], b: readonly ShieldedTokenBalance[]) {
  return (
    a.length === b.length &&
    a.every(
      (balance, i) =>
        balance.token === b[i]!.token &&
        SHIELDED_BALANCE_STATES.every((state) => balance.amounts[state] === b[i]!.amounts[state])
    )
  );
}

/**
 * A ShieldedEngine on Privacy Pools v1 (0xbow), through its public SDK.
 *
 * - The private account is a recovery phrase, kept encrypted with the
 *   password. The same phrase opens the account at privacypools.com.
 * - A scan reads the pools' events, rebuilds the account from them, and
 *   asks the ASP which deposits are approved. Final events are read once
 *   per session; later scans fetch only what is new.
 * - A deposit is `pending` until the ASP approves it, then `spendable`.
 * - `prepareShield` builds the deposit for the Entrypoint. The public
 *   wallet sends it. No signature is needed.
 *
 * It can shield and follow funds. It cannot unshield yet: `prove` rejects.
 * Withdraw at privacypools.com with the recovery phrase until it can.
 */
export function createPrivacyPoolsEngine({
  chains,
  storage = defaultStorage(),
  reviewTime = 3600,
  pollInterval = 60_000,
  client: clientFor,
  fetch: request = (...args) => fetch(...args),
}: PrivacyPoolsEngineOptions): ShieldedEngine {
  const listeners: Record<ShieldedEvent, Set<() => void>> = {
    account: new Set(),
    sync: new Set(),
    balances: new Set(),
  };
  const emit = (event: ShieldedEvent) => {
    for (const listener of listeners[event]) listener();
  };

  let status: ShieldedAccountStatus = storage.getItem(ACCOUNT_KEY) ? "locked" : "none";
  /** The decrypted phrase. Only held while unlocked, never written anywhere in the clear. */
  let mnemonic: string | undefined;
  /** Goes up on every lock. Work that started in an older session stops when it notices. */
  let session = 0;
  let poll: ReturnType<typeof setInterval> | undefined;

  const clients = new Map<number, PrivacyPoolsClient>();
  const chainStates = new Map<number, ChainState>();

  function configOf(chainId: number) {
    const config = chains[chainId];
    if (!config) throw new Error(`Privacy Pools is not set up for chain ${chainId}.`);
    return config;
  }

  function client(chainId: number) {
    let existing = clients.get(chainId);
    if (!existing) {
      existing =
        clientFor?.(chainId) ??
        (createPublicClient({
          transport: http(configOf(chainId).rpcUrl),
        }) as unknown as PrivacyPoolsClient);
      clients.set(chainId, existing);
    }
    return existing;
  }

  function chainOf(chainId: number) {
    let chain = chainStates.get(chainId);
    if (!chain) {
      chain = {
        sync: IDLE,
        balances: undefined,
        transactions: new Map(),
        scan: undefined,
        pools: undefined,
        events: new Map(),
        syncedTo: undefined,
        account: undefined,
      };
      chainStates.set(chainId, chain);
    }
    return chain;
  }

  /** Each pool's address, scope, minimum and fee, read from the Entrypoint once. */
  function poolsOf(chainId: number) {
    const chain = chainOf(chainId);
    if (!chain.pools) {
      const config = configOf(chainId);
      const reader = client(chainId);
      chain.pools = Promise.all(
        config.pools.map(async ({ asset, deploymentBlock }): Promise<Pool> => {
          const [address, minimum, feeBps] = (await reader.readContract({
            address: config.entrypoint,
            abi: ENTRYPOINT_ABI,
            functionName: "assetConfig",
            args: [asset],
          })) as [Address, bigint, bigint, bigint];
          if (BigInt(address) === 0n) throw new Error(`No Privacy Pool for ${asset}.`);
          const [scope, decimals] = await Promise.all([
            reader.readContract({ address, abi: POOL_ABI, functionName: "SCOPE" }),
            isNative(asset)
              ? 18
              : reader.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }),
          ]);
          return {
            asset,
            address,
            scope: scope as bigint,
            decimals: Number(decimals),
            deploymentBlock,
            minimum,
            feeBps,
          };
        })
      );
      // A failed read is tried again by the next caller.
      chain.pools.catch(() => {
        chain.pools = undefined;
      });
    }
    return chain.pools;
  }

  async function poolFor(chainId: number, token: Address) {
    const pool = (await poolsOf(chainId)).find((pool) => lower(pool.asset) === lower(token));
    if (!pool) throw new Error("This token has no Privacy Pool on this chain.");
    return pool;
  }

  function setSync(chain: ChainState, sync: ShieldedSync) {
    chain.sync = sync;
    emit("sync");
  }

  /**
   * Read pool events over a block range, in chunks. A refused chunk is
   * halved and tried again, down to one block.
   */
  async function fetchLogs(
    chainId: number,
    addresses: Address[],
    from: bigint,
    to: bigint,
    onProgress: (done: number) => void
  ) {
    const reader = client(chainId);
    const size = BigInt(Math.max(1, configOf(chainId).blockRange ?? 10_000));
    const logs: PoolLog[] = [];

    async function range(fromBlock: bigint, toBlock: bigint): Promise<void> {
      try {
        const found = await reader.getLogs({
          address: addresses,
          events: POOL_EVENTS,
          fromBlock,
          toBlock,
        });
        logs.push(...(found as PoolLog[]));
      } catch (cause) {
        if (fromBlock === toBlock) throw cause;
        const middle = fromBlock + (toBlock - fromBlock) / 2n;
        await range(fromBlock, middle);
        await range(middle + 1n, toBlock);
      }
    }

    const ranges: [bigint, bigint][] = [];
    for (let start = from; start <= to; start += size) {
      ranges.push([start, start + size - 1n > to ? to : start + size - 1n]);
    }
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < ranges.length) {
        const [start, end] = ranges[next++]!;
        await range(start, end);
        onProgress(++done / ranges.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(LOG_REQUESTS, ranges.length) }, worker));
    return logs;
  }

  /** The ASP's approved labels for a pool, as decimal strings. */
  async function approvedLabels(chainId: number, pool: Pool) {
    const response = await request(`${configOf(chainId).aspUrl}/${chainId}/public/mt-leaves`, {
      headers: { "X-Pool-Scope": pool.scope.toString() },
    });
    if (!response.ok) throw new Error(`The ASP answered ${response.status}.`);
    const { aspLeaves } = (await response.json()) as { aspLeaves?: string[] };
    return new Set(aspLeaves ?? []);
  }

  async function runScan(chainId: number) {
    const chain = chainOf(chainId);
    const started = session;
    const phrase = mnemonic;
    if (!phrase) return;
    let stage: ShieldedSyncStage = "notes";
    const report = (progress: number) => setSync(chain, { stage, status: "syncing", progress });

    try {
      report(0);
      const pools = await poolsOf(chainId);
      const head = await client(chainId).getBlockNumber();
      const first = pools.reduce(
        (lowest, pool) => (pool.deploymentBlock < lowest ? pool.deploymentBlock : lowest),
        pools[0]?.deploymentBlock ?? head
      );
      const from = chain.syncedTo === undefined ? first : chain.syncedTo + 1n;
      const logs =
        from <= head
          ? await fetchLogs(
              chainId,
              pools.map((pool) => pool.address),
              from,
              head,
              (done) => started === session && report(done)
            )
          : [];
      if (started !== session) return;

      // Keep what can no longer be reorganised away. The rest is read again next time.
      const final = head > REORG_DEPTH ? head - REORG_DEPTH : 0n;
      addLogs(
        chain.events,
        logs.filter((log) => log.blockNumber !== null && log.blockNumber <= final)
      );
      if (chain.syncedTo === undefined || final > chain.syncedTo) chain.syncedTo = final;

      const recent = new Map<string, PoolEvents>();
      addLogs(
        recent,
        logs.filter((log) => log.blockNumber !== null && log.blockNumber > final)
      );
      const eventsOf = (pool: PoolInfo, kind: keyof PoolEvents) => [
        ...((chain.events.get(lower(pool.address))?.[kind] ?? []) as never[]),
        ...((recent.get(lower(pool.address))?.[kind] ?? []) as never[]),
      ];

      const { AccountService } = await import("@0xbow/privacy-pools-core-sdk");
      // The SDK's own data service refetches everything on every call. This
      // one answers from the events above.
      const source = {
        getDeposits: async (pool: PoolInfo) => eventsOf(pool, "deposits"),
        getWithdrawals: async (pool: PoolInfo) => eventsOf(pool, "withdrawals"),
        getRagequits: async (pool: PoolInfo) => eventsOf(pool, "ragequits"),
      };
      const { account, errors } = await AccountService.initializeWithEvents(
        source as never,
        { mnemonic: phrase },
        pools.map((pool) => ({
          chainId,
          address: pool.address,
          scope: pool.scope as PoolInfo["scope"],
          deploymentBlock: pool.deploymentBlock,
        }))
      );
      if (started !== session) return;
      // A pool that failed to load is absent, not empty. Show nothing rather than too little.
      if (errors.length > 0) throw new Error(errors[0]!.reason);

      stage = "transactions";
      report(0);
      const approved = new Map<bigint, Set<string>>();
      for (const [index, pool] of pools.entries()) {
        approved.set(pool.scope, await approvedLabels(chainId, pool));
        if (started !== session) return;
        report((index + 1) / pools.length);
      }

      chain.account = account;
      const balances: ShieldedTokenBalance[] = [];
      let changed = false;
      for (const pool of pools) {
        const amounts = { spendable: 0n, pending: 0n, proving: 0n, incomplete: 0n, restricted: 0n };
        let held = false;
        const accounts = account.account.poolAccounts.get(pool.scope as PoolInfo["scope"]) ?? [];
        for (const poolAccount of accounts) {
          const state = poolAccountState(poolAccount, approved.get(pool.scope)!);
          if (state) {
            amounts[state] += (poolAccount.children.at(-1) ?? poolAccount.deposit).value;
            held = true;
          }
          const key = lower(poolAccount.deposit.txHash);
          // Funds that left: withdrawn ones were approved, exited ones went back in public.
          const shown = state ?? (poolAccount.ragequit ? "restricted" : "spendable");
          // A new object only when the state moved, so the reference is stable in between.
          if (chain.transactions.get(key)?.state === shown) continue;
          chain.transactions.set(key, {
            kind: "shield",
            token: pool.asset,
            amount: poolAccount.deposit.value,
            state: shown,
          });
          changed = true;
        }
        if (held) balances.push({ token: pool.asset, amounts });
      }
      if (!chain.balances || !sameBalances(chain.balances, balances)) {
        chain.balances = balances;
        changed = true;
      }
      if (changed) emit("balances");
      setSync(chain, { stage: "transactions", status: "synced", progress: 1 });
    } catch (cause) {
      if (started !== session) return;
      setSync(chain, { ...chain.sync, stage, status: "error", error: reason(cause) });
    }
  }

  /** Scan a chain, or join the scan already running. Does nothing while the account is not unlocked. */
  function scan(chainId: number): Promise<void> {
    if (status !== "unlocked") return Promise.resolve();
    const chain = chainOf(chainId);
    if (!chain.scan) {
      const running: Promise<void> = runScan(chainId).finally(() => {
        if (chain.scan === running) chain.scan = undefined;
      });
      chain.scan = running;
    }
    return chain.scan;
  }

  function reservations(): Reservation[] {
    try {
      return JSON.parse(storage.getItem(RESERVED_KEY) ?? "[]") as Reservation[];
    } catch {
      return [];
    }
  }

  /**
   * Set aside a deposit index for a shield about to be sent.
   *
   * Two deposits made with one index share a nullifier, and the pool lets
   * only one of them be withdrawn privately. The chain can't tell the engine
   * about a deposit that is prepared but not mined, so each prepared shield
   * takes the next index, and keeps it for a while even across reloads.
   */
  function reserveIndex(chainId: number, pool: Pool, fromScan: bigint) {
    const key = `${chainId}:${pool.scope}`;
    const now = Date.now();
    const live = reservations().filter((entry) => now - entry.at < RESERVATION_LIFETIME);
    let index = fromScan;
    for (const entry of live) {
      if (entry.key === key && BigInt(entry.index) >= index) index = BigInt(entry.index) + 1n;
    }
    if (index - fromScan >= MAX_INDEXES_AHEAD) {
      throw new Error(
        "Several shields were started and not confirmed. Wait for them, or try again in half an hour."
      );
    }
    storage.setItem(RESERVED_KEY, JSON.stringify([...live, { key, index: index.toString(), at: now }]));
    return index;
  }

  function requireUnlocked() {
    if (status !== "unlocked") throw new Error("Unlock the private account first.");
  }

  /** Drop everything that needs the decrypted account. */
  function close() {
    session++;
    mnemonic = undefined;
    clearInterval(poll);
    poll = undefined;
    for (const chain of chainStates.values()) {
      chain.sync = IDLE;
      chain.balances = undefined;
      chain.transactions = new Map();
      chain.scan = undefined;
      chain.account = undefined;
    }
    emit("sync");
    emit("balances");
  }

  function open(phrase: string) {
    mnemonic = phrase;
    status = "unlocked";
    emit("account");
    const scanAll = () => {
      for (const chainId of Object.keys(chains)) void scan(Number(chainId));
    };
    scanAll();
    if (pollInterval > 0) poll = setInterval(scanAll, pollInterval);
  }

  async function setAccount(phrase: string, password: string) {
    if (!password) throw new Error("Choose a password.");
    const stored = await encryptPhrase(phrase, password);
    if (status === "unlocked") close();
    storage.setItem(ACCOUNT_KEY, stored);
    // Indexes set aside for another account mean nothing to this one.
    storage.removeItem(RESERVED_KEY);
    open(phrase);
  }

  return {
    id: "privacy-pools",
    shieldsNative: true,

    account: {
      status: () => status,
      // Privacy Pools v1 has no private address: funds enter through a deposit and leave to a public address.
      address: () => null,
      async create(password) {
        const phrase = generateMnemonic(english);
        await setAccount(phrase, password);
        return { mnemonic: phrase };
      },
      async import(phrase, password) {
        const words = phrase.trim().toLowerCase().split(/\s+/);
        if (words.length !== 12 && words.length !== 24) {
          throw new Error("A recovery phrase has 12 or 24 words.");
        }
        if (words.some((word) => !english.includes(word))) {
          throw new Error("That is not a valid recovery phrase.");
        }
        await setAccount(words.join(" "), password);
      },
      async unlock(password) {
        if (status === "unlocked") return;
        const stored = storage.getItem(ACCOUNT_KEY);
        if (!stored) throw new Error("There is no private account to unlock.");
        const phrase = await decryptPhrase(stored, password);
        // Another unlock may have finished while this one was decrypting.
        if (mnemonic === undefined) open(phrase);
      },
      lock() {
        if (status !== "unlocked") return;
        status = "locked";
        close();
        emit("account");
      },
    },

    subscribe(event, listener) {
      listeners[event].add(listener);
      return () => {
        listeners[event].delete(listener);
      };
    },

    getSync: (chainId) => chainOf(chainId).sync,
    getBalances: (chainId) => chainOf(chainId).balances,
    getTransaction: (chainId, hash) => chainOf(chainId).transactions.get(lower(hash)),
    sync: scan,

    // Nothing in Privacy Pools v1 is ever `incomplete`.
    async retryProofs() {},

    async quoteShield(draft) {
      if (draft.amount <= 0n) throw new Error("Enter an amount.");
      const pool = await poolFor(draft.chainId, draft.token);
      if (draft.amount < pool.minimum) {
        throw new Error(`The minimum is ${formatUnits(pool.minimum, pool.decimals)}.`);
      }
      const fee = (draft.amount * pool.feeBps) / 10_000n;
      return {
        fee,
        received: draft.amount - fee,
        standby: reviewTime,
        spender: isNative(pool.asset) ? undefined : configOf(draft.chainId).entrypoint,
        needsSignature: false,
      };
    },

    async prepareShield(draft) {
      requireUnlocked();
      const started = session;
      const pool = await poolFor(draft.chainId, draft.token);
      if (draft.amount < pool.minimum) {
        throw new Error(`The minimum is ${formatUnits(pool.minimum, pool.decimals)}.`);
      }

      const chain = chainOf(draft.chainId);
      const scope = pool.scope as PoolInfo["scope"];
      // The next index comes from the pool's history. Without all of it, an index could be used twice.
      if (!chain.account?.isScopeComplete(scope)) await scan(draft.chainId);
      if (started !== session) throw new Error("The private account was locked.");
      const account = chain.account;
      if (!account?.isScopeComplete(scope)) {
        throw new Error("Couldn't read the pool's history. Scan again before shielding.");
      }

      const fromScan = nextDepositIndex(account.account.poolAccounts.get(scope) ?? []);
      // The SDK keeps its own count. If the two ever disagree, stop before any funds move.
      if (
        account.createDepositSecrets(scope).precommitment !==
        account.createDepositSecrets(scope, fromScan).precommitment
      ) {
        throw new Error("Couldn't work out the next deposit index.");
      }
      const { precommitment } = account.createDepositSecrets(
        scope,
        reserveIndex(draft.chainId, pool, fromScan)
      );

      const to = configOf(draft.chainId).entrypoint;
      return {
        transaction: isNative(pool.asset)
          ? {
              to,
              data: encodeFunctionData({
                abi: ENTRYPOINT_ABI,
                functionName: "deposit",
                args: [precommitment],
              }),
              value: draft.amount,
            }
          : {
              to,
              data: encodeFunctionData({
                abi: ENTRYPOINT_ABI,
                functionName: "deposit",
                args: [pool.asset, draft.amount, precommitment],
              }),
              value: 0n,
            },
      };
    },

    async prove() {
      throw new Error("This engine can't unshield yet. Withdraw at privacypools.com.");
    },
  };
}
