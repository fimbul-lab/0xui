// Docs: https://0xui.io/components/privacy-pools-engine.md
import type {
  AccountCommitment,
  AccountService,
  DepositEvent,
  Hash as PoolHash,
  PoolAccount,
  PoolInfo,
  PrivacyPoolSDK,
  RagequitEvent,
  WithdrawalEvent,
  WithdrawalProof,
} from "@0xbow/privacy-pools-core-sdk";
import {
  createPublicClient,
  decodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  formatUnits,
  http,
  isAddress,
  isHex,
  parseAbi,
} from "viem";
import type { Address, Hash, Hex } from "viem";
import { english, generateMnemonic } from "viem/accounts";
import { SHIELDED_BALANCE_STATES } from "@/lib/shielded-engine";
import type {
  PrivateDraft,
  ShieldedAccountStatus,
  ShieldedBalanceState,
  ShieldedEngine,
  ShieldedEvent,
  ShieldedExit,
  ShieldedSync,
  ShieldedSyncStage,
  ShieldedTokenBalance,
  ShieldedTransaction,
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
  /**
   * The relayer that sends withdrawals, so an unshield is not paid for from
   * a public wallet. Without one the engine can't unshield on this chain.
   */
  relayerUrl?: string;
  /** Pools to scan and offer. */
  pools: ReadonlyArray<PrivacyPoolsPool>;
  /** Blocks per `eth_getLogs` request. Halved on its own when the RPC refuses a range. Default 10,000. */
  blockRange?: number;
};

/** Privacy Pools v1 on Sepolia: ETH, USDC and USDT. Bring your own `rpcUrl`. */
export const PRIVACY_POOLS_SEPOLIA = {
  entrypoint: "0x34A2068192b1297f2a7f85D7D8CdE66F8F0921cB",
  aspUrl: "https://dw.0xbow.io",
  relayerUrl: "https://testnet-relayer.privacypools.com",
  pools: [
    { asset: PRIVACY_POOLS_NATIVE, deploymentBlock: 8_587_019n },
    { asset: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", deploymentBlock: 8_587_019n },
    { asset: "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0", deploymentBlock: 8_587_019n },
  ],
} as const satisfies Omit<PrivacyPoolsChain, "rpcUrl">;

/** Where the encrypted recovery phrase is kept. `localStorage` fits. */
export type PrivacyPoolsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A pool event read from a decoded log, in the SDK's shape, with the pool it came from. */
type PoolLog = { pool: string; blockNumber: bigint } & (
  | { kind: "deposits"; event: DepositEvent }
  | { kind: "withdrawals"; event: WithdrawalEvent }
  | { kind: "ragequits"; event: RagequitEvent }
);

/**
 * Where pool events are kept between page loads, so a reload reads only what
 * is new. The events are public and the same for every account: nothing in
 * here says which deposits are yours.
 */
export type PrivacyPoolsCache = {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
};

/** The chain reads the engine makes. viem's PublicClient fits. */
export type PrivacyPoolsClient = {
  getBlockNumber(): Promise<bigint>;
  getLogs(args: {
    address: Array<Address>;
    events: typeof POOL_EVENTS;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<Array<unknown>>;
  readContract(args: {
    address: Address;
    abi: ReadonlyArray<unknown>;
    functionName: string;
    args?: ReadonlyArray<unknown>;
    // oxlint-disable-next-line quality/no-unknown-returns -- what a read returns depends on the ABI passed; the engine parses each answer
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
  /**
   * Keeps pool events between page loads. Defaults to IndexedDB where there
   * is one. Pass `false` to read everything again on every load.
   */
  cache?: PrivacyPoolsCache | false;
  /** HTTP for the ASP and the relayer. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /**
   * Where the circuit files are served from, needed to unshield. The engine
   * loads `artifacts/withdraw.wasm` and five more files relative to this URL,
   * about 24 MB in total, on the first proof. The SDK checks each file
   * against a hash it ships with, so the host does not have to be trusted.
   */
  circuitsUrl?: string;
  /**
   * Ask the ASP whether deposits it has not approved were declined, so they
   * read as `restricted` and not `pending` forever. Off by default: the ASP
   * can only be asked about named deposits, which tells it they are yours.
   */
  checkDeclined?: boolean;
};

const ENTRYPOINT_ABI = parseAbi([
  "function deposit(uint256 _precommitment) payable returns (uint256 _commitment)",
  "function deposit(address _asset, uint256 _value, uint256 _precommitment) returns (uint256 _commitment)",
  "function assetConfig(address _asset) view returns (address pool, uint256 minimumDepositAmount, uint256 vettingFeeBPS, uint256 maxRelayFeeBPS)",
]);

const POOL_ABI = parseAbi([
  "function SCOPE() view returns (uint256)",
  "struct RagequitProof { uint256[2] pA; uint256[2][2] pB; uint256[2] pC; uint256[4] pubSignals; }",
  "function ragequit(RagequitProof _proof)",
]);

const ASP_ROOT_ABI = parseAbi(["function latestRoot() view returns (uint256)"]);

/** What a relayed withdrawal carries: who is paid, and the relayer's cut. */
const RELAY_DATA = [
  { name: "recipient", type: "address" },
  { name: "feeRecipient", type: "address" },
  { name: "relayFeeBPS", type: "uint256" },
] as const;

/** Both trees are proven at the circuit's full depth. */
const TREE_DEPTH = 32n;

/** How long a proof is offered for. The ASP's list can change sooner, and then the relayer refuses it. */
const PROOF_LIFETIME = 10 * 60_000;

/** A fee commitment this close to its end is replaced before it is used. */
const COMMITMENT_MARGIN = 10_000;

/**
 * How long `submit` looks for a withdrawal on chain after the relayer gave
 * no clear answer, and how often.
 */
const RELAY_WATCH = 90_000;
const RELAY_WATCH_INTERVAL = 6000;

/** How long funds read as `proving` after a withdrawal was handed to the relayer. */
const SUBMITTED_LIFETIME = 10 * 60_000;

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

/** How often a rate-limited request is tried again, and the first wait. Each wait is twice the last. */
const RATE_LIMIT_RETRIES = 6;
const RATE_LIMIT_WAIT = 1000;

/** Final blocks read since the last save before the cache is written again, when no event came with them. */
const CACHE_STRIDE = 2000n;

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;
const isArray = (value: unknown): value is ReadonlyArray<unknown> => Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number";
const isBigint = (value: unknown): value is bigint => typeof value === "bigint";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
  isArray(value) && value.every(isString);
const isOptionalNumber = (value: unknown): value is number | undefined =>
  value === undefined || isNumber(value);
/** The SDK brands its uint256 hashes. On chain and in JSON they are plain numbers. */
const isPoolHash = <T>(value: T): value is T & PoolHash => typeof value === "bigint";
const textOf = (value: unknown) => (isString(value) ? value : undefined);

/** True when an RPC refused a request for coming too fast, not for what it asked. */
function isRateLimit(cause: unknown) {
  if (!isObject(cause)) {
    return false;
  }
  const details = "details" in cause ? textOf(cause.details) : undefined;
  const message = "message" in cause ? textOf(cause.message) : undefined;
  return (
    ("status" in cause && cause.status === 429) ||
    ("code" in cause && cause.code === -32_005) ||
    /rate limit|too many requests|429/i.test(`${details ?? ""} ${message ?? ""}`)
  );
}

// JSON has no bigint. Events carry many.
const toJson = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? `${item}n` : item));

const openEventsDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("0xui.privacy-pools", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("events");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/** Run one request on the events store, and read its result. */
async function inEventStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest,
  read: (result: unknown) => T,
) {
  const database = await openEventsDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(database.transaction("events", mode).objectStore("events"));
      request.onsuccess = () => resolve(read(request.result));
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

/** A cache in IndexedDB, or undefined where there is none. */
function browserCache(): PrivacyPoolsCache | undefined {
  if (typeof indexedDB === "undefined") {
    return undefined;
  }
  return {
    get: (key) =>
      inEventStore(
        "readonly",
        (store) => store.get(key),
        (value) => (isString(value) ? value : undefined),
      ),
    set: async (key, value) => {
      await inEventStore(
        "readwrite",
        (store) => store.put(value, key),
        () => undefined,
      );
    },
  };
}

const PBKDF2_ROUNDS = 600_000;

const IDLE: ShieldedSync = Object.freeze({ stage: "notes", status: "idle", progress: 0 });

const lower = (value: string) => value.toLowerCase();
const isNative = (asset: Address) => lower(asset) === lower(PRIVACY_POOLS_NATIVE);

/** One line saying why. viem's full message carries the whole request. */
function reason(cause: unknown) {
  if (isObject(cause)) {
    const details = "details" in cause ? textOf(cause.details) : undefined;
    const shortMessage = "shortMessage" in cause ? textOf(cause.shortMessage) : undefined;
    const message = "message" in cause ? textOf(cause.message) : undefined;
    const line = details || shortMessage || message;
    if (line) {
      return line;
    }
  }
  return String(cause);
}

/**
 * Where a pool account's funds are, or undefined when it holds nothing: it
 * was withdrawn in full, exited or migrated. `approved` is the ASP's set of
 * approved labels, as decimal strings.
 *
 * Without `declined`, a declined deposit reads as `pending`: the ASP
 * publishes approvals in bulk, but a decline can only be asked about named
 * deposits, which tells the ASP they are yours. `declined` is the set of
 * labels it said no to, for callers that chose to ask.
 */
export function poolAccountState(
  account: Pick<PoolAccount, "label" | "deposit" | "children" | "ragequit" | "isMigrated">,
  approved: ReadonlySet<string>,
  declined?: ReadonlySet<string>,
): ShieldedBalanceState | undefined {
  if (account.ragequit || account.isMigrated) {
    return undefined;
  }
  const latest = account.children.at(-1) ?? account.deposit;
  if (latest.value === 0n) {
    return undefined;
  }
  const label = account.label.toString();
  if (approved.has(label)) {
    return "spendable";
  }
  return declined?.has(label) ? "restricted" : "pending";
}

/**
 * The next unused deposit index for a pool, from its reconstructed
 * accounts. Indexes of failed deposits stay unused: an index is never
 * handed out twice.
 */
export function nextDepositIndex(
  accounts: ReadonlyArray<Pick<PoolAccount, "depositIndex" | "isMigrationDerived">>,
) {
  let highest = -1n;
  let derived = 0n;
  for (const account of accounts) {
    if (account.isMigrationDerived) {
      continue;
    }
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
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ROUNDS },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt a recovery phrase with a password: PBKDF2-SHA256 into AES-256-GCM. */
export async function encryptPhrase(mnemonic: string, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await passwordKey(password, salt),
    new TextEncoder().encode(mnemonic),
  );
  return JSON.stringify({
    v: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(data)),
  });
}

/** What `encryptPhrase` writes, in base64. */
type EncryptedPhrase = { salt: string; iv: string; data: string };

const isEncryptedPhrase = (value: unknown): value is EncryptedPhrase =>
  isObject(value) &&
  "salt" in value &&
  isString(value.salt) &&
  "iv" in value &&
  isString(value.iv) &&
  "data" in value &&
  isString(value.data);

/** Decrypt what `encryptPhrase` made. Rejects with "Wrong password." */
export async function decryptPhrase(stored: string, password: string) {
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!isEncryptedPhrase(parsed)) {
      throw new Error("Not an encrypted phrase.");
    }
    const { salt, iv, data } = parsed;
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(iv) },
      await passwordKey(password, fromBase64(salt)),
      fromBase64(data),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("Wrong password.");
  }
}

/**
 * Load the SDK, on first use. Its browser build calls Node's `assert`, and
 * the `assert` package reads `process.env` as it loads. Bundlers no longer
 * provide `process`, so make sure a minimal one is there.
 */
function loadSdk() {
  const scope = globalThis as { process?: unknown };
  scope.process ??= { env: {}, browser: true };
  return import("@0xbow/privacy-pools-core-sdk");
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
    if (typeof localStorage !== "undefined") {
      return localStorage;
    }
  } catch {
    // Blocked, as in a sandboxed frame. Memory keeps the session working.
  }
  return memoryStorage();
}

type Pool = {
  asset: Address;
  address: Address;
  scope: PoolHash;
  decimals: number;
  deploymentBlock: bigint;
  minimum: bigint;
  feeBps: bigint;
  /** The most a relayer may take, in basis points. */
  maxRelayFeeBps: bigint;
};

/**
 * The relayer's signed promise to send a withdrawal for a fee. Lasts about a
 * minute. It carries more than this, such as the signature, and goes back to
 * the relayer as it came.
 */
type FeeCommitment = { expiration: number; withdrawalData: Hex };

const isFeeCommitment = (value: unknown): value is FeeCommitment =>
  isObject(value) &&
  "expiration" in value &&
  isNumber(value.expiration) &&
  "withdrawalData" in value &&
  isHex(value.withdrawalData);

/** A number the relayer may send as a string or as JSON's number. */
const isAmount = (value: unknown): value is string | number => isString(value) || isNumber(value);

/** The relayer's smallest withdrawal, from its `details` answer. */
const parseMinimum = (answer: unknown) =>
  isObject(answer) && "minWithdrawAmount" in answer && isAmount(answer.minWithdrawAmount)
    ? answer.minWithdrawAmount
    : undefined;

type RelayerQuote = { feeBPS: string | number; feeCommitment?: FeeCommitment };

function parseQuote(answer: unknown): RelayerQuote | undefined {
  if (!isObject(answer) || !("feeBPS" in answer) || !isAmount(answer.feeBPS)) {
    return undefined;
  }
  const feeCommitment =
    "feeCommitment" in answer && isFeeCommitment(answer.feeCommitment)
      ? answer.feeCommitment
      : undefined;
  return { feeBPS: answer.feeBPS, feeCommitment };
}

/** What the relayer says about a withdrawal it was asked to send. */
type RelayAnswer = { success?: boolean; txHash?: Hash; error?: string };

function parseRelayAnswer(answer: unknown): RelayAnswer {
  if (!isObject(answer)) {
    return {};
  }
  return {
    success: "success" in answer && isBoolean(answer.success) ? answer.success : undefined,
    txHash: "txHash" in answer && isHex(answer.txHash) ? answer.txHash : undefined,
    error: "error" in answer ? textOf(answer.error) : undefined,
  };
}

/** Why the relayer refused, when it says. */
function refusalOf(answer: unknown) {
  if (!isObject(answer)) {
    return undefined;
  }
  return (
    ("message" in answer ? textOf(answer.message) : undefined) ??
    ("error" in answer ? textOf(answer.error) : undefined)
  );
}

/** A proved withdrawal, waiting to be handed to the relayer. */
type Proved = {
  session: number;
  pool: Pool;
  source: AccountCommitment;
  proof: WithdrawalProof;
  feeCommitment: FeeCommitment;
};

type PoolEvents = {
  deposits: Array<DepositEvent>;
  withdrawals: Array<WithdrawalEvent>;
  ragequits: Array<RagequitEvent>;
};

type ChainState = {
  sync: ShieldedSync;
  balances: ReadonlyArray<ShieldedTokenBalance> | undefined;
  /** Shields the last scan found, by lower-case hash. */
  transactions: Map<string, ShieldedTransaction>;
  scan: Promise<void> | undefined;
  /** One more scan, queued behind the running one. */
  rescan: Promise<void> | undefined;
  pools: Promise<Array<Pool>> | undefined;
  /** Final events, by lower-case pool address, read up to `syncedTo`. */
  events: Map<string, PoolEvents>;
  syncedTo: bigint | undefined;
  /** How far the cache on disk reaches, and whether it has been read this session. */
  cachedTo: bigint | undefined;
  cacheRead: boolean;
  /** The account as the last complete scan rebuilt it. */
  account: AccountService | undefined;
  /** Approved labels the last scan saw, by pool scope. */
  approved: Map<bigint, Set<string>>;
  /** Labels the ASP declined, when `checkDeclined` is on. */
  declined: Set<string>;
  /** Public exits the last scan found. */
  exits: ReadonlyArray<ShieldedExit> | undefined;
  /** Withdrawals the last scan saw, by spent nullifier hash, with their transaction. */
  withdrawals: Map<bigint, Hash>;
  /** What `prepareExit` needs for each exit, by id. */
  exitSources: Map<string, { pool: Pool; commitment: AccountCommitment }>;
  /** Commitments handed to the relayer, by hash, with when. They read as `proving` until a scan sees them spent. */
  submitted: Map<bigint, number>;
};

type Reservation = { key: string; index: string; at: number };

const isReservation = (value: unknown): value is Reservation =>
  isObject(value) &&
  "key" in value &&
  isString(value.key) &&
  "index" in value &&
  isString(value.index) &&
  "at" in value &&
  isNumber(value.at);

const emptyEvents = (): PoolEvents => ({ deposits: [], withdrawals: [], ragequits: [] });

const NO_LABELS: ReadonlySet<string> = new Set();

/** The arguments of each pool event, as viem decodes them from `POOL_EVENTS`. */
type DepositedArgs = {
  _depositor: string;
  _commitment: PoolHash;
  _label: PoolHash;
  _value: bigint;
  _merkleRoot: PoolHash;
};
type WithdrawnArgs = { _value: bigint; _spentNullifier: PoolHash; _newCommitment: PoolHash };
type RagequitArgs = {
  _ragequitter: string;
  _commitment: PoolHash;
  _label: PoolHash;
  _value: bigint;
};

const isDepositedArgs = (args: unknown): args is DepositedArgs =>
  isObject(args) &&
  "_depositor" in args &&
  isString(args._depositor) &&
  "_commitment" in args &&
  isPoolHash(args._commitment) &&
  "_label" in args &&
  isPoolHash(args._label) &&
  "_value" in args &&
  isBigint(args._value) &&
  "_merkleRoot" in args &&
  isPoolHash(args._merkleRoot);

const isWithdrawnArgs = (args: unknown): args is WithdrawnArgs =>
  isObject(args) &&
  "_value" in args &&
  isBigint(args._value) &&
  "_spentNullifier" in args &&
  isPoolHash(args._spentNullifier) &&
  "_newCommitment" in args &&
  isPoolHash(args._newCommitment);

const isRagequitArgs = (args: unknown): args is RagequitArgs =>
  isObject(args) &&
  "_ragequitter" in args &&
  isString(args._ragequitter) &&
  "_commitment" in args &&
  isPoolHash(args._commitment) &&
  "_label" in args &&
  isPoolHash(args._label) &&
  "_value" in args &&
  isBigint(args._value);

/**
 * Read a decoded log, as viem's `getLogs` returns it, into the SDK's event
 * shape. Undefined for a log not mined yet, which a later scan reads again,
 * and for any other event.
 */
function parseLog(log: unknown): PoolLog | undefined {
  if (
    !isObject(log) ||
    !("blockNumber" in log) ||
    !isBigint(log.blockNumber) ||
    !("transactionHash" in log) ||
    !isHex(log.transactionHash)
  ) {
    return undefined;
  }
  const eventName = "eventName" in log ? log.eventName : undefined;
  if (eventName !== "Deposited" && eventName !== "Withdrawn" && eventName !== "Ragequit") {
    return undefined;
  }
  const address = "address" in log ? textOf(log.address) : undefined;
  const args = "args" in log ? log.args : undefined;
  const at = { blockNumber: log.blockNumber, transactionHash: log.transactionHash };
  if (address === undefined) {
    throw new Error("A pool event could not be read.");
  }
  const pool = lower(address);
  if (eventName === "Deposited" && isDepositedArgs(args)) {
    const event = {
      ...at,
      depositor: lower(args._depositor),
      commitment: args._commitment,
      label: args._label,
      value: args._value,
      precommitment: args._merkleRoot,
      logIndex: "logIndex" in log && isNumber(log.logIndex) ? log.logIndex : undefined,
    };
    return { pool, blockNumber: at.blockNumber, kind: "deposits", event };
  }
  if (eventName === "Withdrawn" && isWithdrawnArgs(args)) {
    const event = {
      ...at,
      withdrawn: args._value,
      spentNullifier: args._spentNullifier,
      newCommitment: args._newCommitment,
    };
    return { pool, blockNumber: at.blockNumber, kind: "withdrawals", event };
  }
  if (eventName === "Ragequit" && isRagequitArgs(args)) {
    const event = {
      ...at,
      ragequitter: lower(args._ragequitter),
      commitment: args._commitment,
      label: args._label,
      value: args._value,
    };
    return { pool, blockNumber: at.blockNumber, kind: "ragequits", event };
  }
  throw new Error(`A ${eventName} event could not be read.`);
}

/** Group events read from logs by pool. */
function addLogs(target: Map<string, PoolEvents>, logs: ReadonlyArray<PoolLog>) {
  for (const log of logs) {
    let events = target.get(log.pool);
    if (!events) {
      events = emptyEvents();
      target.set(log.pool, events);
    }
    if (log.kind === "deposits") {
      events.deposits.push(log.event);
    } else if (log.kind === "withdrawals") {
      events.withdrawals.push(log.event);
    } else {
      events.ragequits.push(log.event);
    }
  }
}

/** Where an event is on chain, as the SDK's event shapes keep it. */
type EventPosition = { blockNumber: bigint; transactionHash: Hex };

const isEventPosition = (value: unknown): value is EventPosition =>
  isObject(value) &&
  "blockNumber" in value &&
  isBigint(value.blockNumber) &&
  "transactionHash" in value &&
  isHex(value.transactionHash);

const isDepositEvent = (value: unknown): value is DepositEvent =>
  isEventPosition(value) &&
  "depositor" in value &&
  isString(value.depositor) &&
  "commitment" in value &&
  isPoolHash(value.commitment) &&
  "label" in value &&
  isPoolHash(value.label) &&
  "value" in value &&
  isBigint(value.value) &&
  "precommitment" in value &&
  isPoolHash(value.precommitment) &&
  (!("logIndex" in value) || isOptionalNumber(value.logIndex));

const isWithdrawalEvent = (value: unknown): value is WithdrawalEvent =>
  isEventPosition(value) &&
  "withdrawn" in value &&
  isBigint(value.withdrawn) &&
  "spentNullifier" in value &&
  isPoolHash(value.spentNullifier) &&
  "newCommitment" in value &&
  isPoolHash(value.newCommitment);

const isRagequitEvent = (value: unknown): value is RagequitEvent =>
  isEventPosition(value) &&
  "ragequitter" in value &&
  isString(value.ragequitter) &&
  "commitment" in value &&
  isPoolHash(value.commitment) &&
  "label" in value &&
  isPoolHash(value.label) &&
  "value" in value &&
  isBigint(value.value);

function parsePoolEvents(value: unknown): PoolEvents | undefined {
  if (
    !isObject(value) ||
    !("deposits" in value) ||
    !("withdrawals" in value) ||
    !("ragequits" in value)
  ) {
    return undefined;
  }
  const { deposits, withdrawals, ragequits } = value;
  if (
    !isArray(deposits) ||
    !deposits.every(isDepositEvent) ||
    !isArray(withdrawals) ||
    !withdrawals.every(isWithdrawalEvent) ||
    !isArray(ragequits) ||
    !ragequits.every(isRagequitEvent)
  ) {
    return undefined;
  }
  return { deposits: [...deposits], withdrawals: [...withdrawals], ragequits: [...ragequits] };
}

/** What the cache keeps for a chain: final events by pool, and the block they reach. */
type CachedEvents = { syncedTo: bigint; events: Array<[string, PoolEvents]> };

/** Read what `toJson` wrote for a chain. Undefined when it is something else. */
function parseCachedEvents(text: string): CachedEvents | undefined {
  const value: unknown = JSON.parse(text, (_key, item: unknown) =>
    typeof item === "string" && /^-?\d+n$/.test(item) ? BigInt(item.slice(0, -1)) : item,
  );
  if (!isObject(value) || !("syncedTo" in value) || !("events" in value)) {
    return undefined;
  }
  const { syncedTo, events: entries } = value;
  if (!isBigint(syncedTo) || !isArray(entries)) {
    return undefined;
  }
  const events: CachedEvents["events"] = [];
  for (const entry of entries) {
    const [pool, poolEvents] = isArray(entry) ? entry : [];
    const parsed = parsePoolEvents(poolEvents);
    if (!isString(pool) || !parsed) {
      return undefined;
    }
    events.push([pool, parsed]);
  }
  return { syncedTo, events };
}

/** One entry per chain and set of pools. Changing the pools starts a new one. */
function cacheKey(chainId: number, pools: Array<Pool>) {
  const parts = pools.map((pool) => `${lower(pool.address)}@${pool.deploymentBlock}`).sort();
  return `events:${chainId}:${parts.join(",")}`;
}

/** An Entrypoint's `assetConfig` answer. */
function parseAssetConfig(value: unknown) {
  const [address, minimum, feeBps, maxRelayFeeBps] = isArray(value) ? value : [];
  if (
    !isString(address) ||
    !isAddress(address, { strict: false }) ||
    !isBigint(minimum) ||
    !isBigint(feeBps) ||
    !isBigint(maxRelayFeeBps)
  ) {
    return undefined;
  }
  return { address, minimum, feeBps, maxRelayFeeBps };
}

/** A list of decimal strings in the ASP's answer. A missing list is empty. */
function leafList(leaves: unknown) {
  if (leaves === undefined) {
    return [];
  }
  if (!isStringArray(leaves)) {
    throw new Error("The ASP's answer could not be read.");
  }
  return leaves;
}

/** The ASP's two trees for a pool: approved labels, and every commitment. */
function parseLeaves(body: unknown) {
  if (!isObject(body)) {
    throw new Error("The ASP's answer could not be read.");
  }
  return {
    aspLeaves: leafList("aspLeaves" in body ? body.aspLeaves : undefined),
    stateTreeLeaves: leafList("stateTreeLeaves" in body ? body.stateTreeLeaves : undefined),
  };
}

/** A Merkle proof's root, as the SDK's hash. */
function rootOf(proof: { root: bigint }) {
  const { root } = proof;
  if (!isPoolHash(root)) {
    throw new Error("The Merkle proof has no root.");
  }
  return root;
}

const unexpectedProof = () => new Error("The proof has an unexpected shape. Nothing was sent.");

/** Two numbers of a proof's point, as the verifier contract takes them. */
function pair(values: ReadonlyArray<string> | undefined) {
  const [x, y] = values ?? [];
  if (x === undefined || y === undefined) {
    throw unexpectedProof();
  }
  return [BigInt(x), BigInt(y)] as const;
}

/** The verifier contract takes each pair of a proof's middle point the other way round. */
function flipped(values: ReadonlyArray<string> | undefined) {
  const [x, y] = pair(values);
  return [y, x] as const;
}

/**
 * The relayer writes the withdrawal's instructions, and the proof is bound
 * to them. Check they pay the draft's recipient, at the quoted fee, before
 * proving anything.
 */
function checkCommitment(
  commitment: FeeCommitment | undefined,
  draft: PrivateDraft,
  feeBps: bigint,
): asserts commitment is FeeCommitment {
  let decoded: readonly [Address, Address, bigint];
  try {
    if (!commitment) {
      throw new Error("no commitment");
    }
    decoded = decodeAbiParameters(RELAY_DATA, commitment.withdrawalData);
  } catch {
    throw new Error("The relayer's answer could not be read.");
  }
  if (lower(decoded[0]) !== lower(draft.recipient) || decoded[2] !== feeBps) {
    throw new Error("The relayer's answer does not match this unshield. Nothing was sent.");
  }
}

/** Reject with the signal's reason as soon as it aborts, without waiting for `work`. */
function abortable<T>(work: Promise<T>, signal?: AbortSignal) {
  if (!signal) {
    return work;
  }
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** Chain reads through viem, on an RPC. */
function viemClient(rpcUrl: string): PrivacyPoolsClient {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return {
    getBlockNumber: () => client.getBlockNumber(),
    getLogs: (args) => client.getLogs(args),
    readContract: (args) => client.readContract(args),
  };
}

function sameExits(a: ReadonlyArray<ShieldedExit>, b: ReadonlyArray<ShieldedExit>) {
  return (
    a.length === b.length &&
    a.every((exit, i) => {
      const other = b[i];
      return (
        other !== undefined &&
        exit.id === other.id &&
        exit.amount === other.amount &&
        exit.state === other.state &&
        exit.depositor === other.depositor
      );
    })
  );
}

function sameBalances(
  a: ReadonlyArray<ShieldedTokenBalance>,
  b: ReadonlyArray<ShieldedTokenBalance>,
) {
  return (
    a.length === b.length &&
    a.every((balance, i) => {
      const other = b[i];
      return (
        other !== undefined &&
        balance.token === other.token &&
        SHIELDED_BALANCE_STATES.every((state) => balance.amounts[state] === other.amounts[state])
      );
    })
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
 * - An unshield spends one deposit: `prove` makes the withdrawal proof in
 *   the browser and `submit` hands it to the relayer, which sends it and
 *   keeps a fee. It needs `relayerUrl` and `circuitsUrl`.
 * - An exit (ragequit) returns one deposit to the address that made it, in
 *   public, whether the ASP approved it or not. `prepareExit` makes the
 *   proof and builds the transaction; that address's wallet sends it.
 */
export function createPrivacyPoolsEngine({
  chains,
  storage = defaultStorage(),
  reviewTime = 3600,
  pollInterval = 60_000,
  client: clientFor,
  fetch: request = (...args) => fetch(...args),
  circuitsUrl,
  checkDeclined = false,
  cache: cacheOption,
}: PrivacyPoolsEngineOptions): ShieldedEngine {
  const listeners: Record<ShieldedEvent, Set<() => void>> = {
    account: new Set(),
    sync: new Set(),
    balances: new Set(),
  };
  const emit = (event: ShieldedEvent) => {
    for (const listener of listeners[event]) {
      listener();
    }
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
    if (!config) {
      throw new Error(`Privacy Pools is not set up for chain ${chainId}.`);
    }
    return config;
  }

  function client(chainId: number) {
    let existing = clients.get(chainId);
    if (!existing) {
      existing = clientFor?.(chainId) ?? viemClient(configOf(chainId).rpcUrl);
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
        rescan: undefined,
        pools: undefined,
        events: new Map(),
        syncedTo: undefined,
        cachedTo: undefined,
        cacheRead: false,
        account: undefined,
        approved: new Map(),
        declined: new Set(),
        exits: undefined,
        withdrawals: new Map(),
        exitSources: new Map(),
        submitted: new Map(),
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
          const answer = parseAssetConfig(
            await reader.readContract({
              address: config.entrypoint,
              abi: ENTRYPOINT_ABI,
              functionName: "assetConfig",
              args: [asset],
            }),
          );
          if (!answer) {
            throw new Error(`The Entrypoint's answer for ${asset} could not be read.`);
          }
          const { address, minimum, feeBps, maxRelayFeeBps } = answer;
          if (BigInt(address) === 0n) {
            throw new Error(`No Privacy Pool for ${asset}.`);
          }
          const [scope, decimals] = await Promise.all([
            reader.readContract({ address, abi: POOL_ABI, functionName: "SCOPE" }),
            isNative(asset)
              ? 18
              : reader.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }),
          ]);
          if (!isPoolHash(scope)) {
            throw new Error(`The Privacy Pool for ${asset} has no scope.`);
          }
          return {
            asset,
            address,
            scope,
            decimals: Number(decimals),
            deploymentBlock,
            minimum,
            feeBps,
            maxRelayFeeBps,
          };
        }),
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
    if (!pool) {
      throw new Error("This token has no Privacy Pool on this chain.");
    }
    return pool;
  }

  function setSync(chain: ChainState, sync: ShieldedSync) {
    chain.sync = sync;
    emit("sync");
  }

  const cache = cacheOption === false ? undefined : (cacheOption ?? browserCache());

  /** Load final events saved by an earlier page load. A cache that can't be read is ignored. */
  async function readCache(chainId: number, pools: Array<Pool>) {
    const chain = chainOf(chainId);
    if (chain.cacheRead) {
      return;
    }
    chain.cacheRead = true;
    if (!cache || chain.syncedTo !== undefined) {
      return;
    }
    try {
      const stored = await cache.get(cacheKey(chainId, pools));
      if (!stored) {
        return;
      }
      const cached = parseCachedEvents(stored);
      if (!cached || chain.syncedTo !== undefined) {
        return;
      }
      const { syncedTo, events } = cached;
      chain.events = new Map(events);
      chain.syncedTo = chain.cachedTo = syncedTo;
    } catch {
      // Unreadable or from another version. The scan reads the chain instead.
    }
  }

  async function writeCache(chainId: number, pools: Array<Pool>) {
    const chain = chainOf(chainId);
    if (!cache || chain.syncedTo === undefined) {
      return;
    }
    chain.cachedTo = chain.syncedTo;
    try {
      await cache.set(
        cacheKey(chainId, pools),
        toJson({ syncedTo: chain.syncedTo, events: [...chain.events] }),
      );
    } catch {
      // A full or blocked disk only costs the next load a longer scan.
    }
  }

  /**
   * Read pool events over a block range, in chunks. A chunk refused for its
   * size is halved and tried again, down to one block. A chunk refused for
   * coming too fast is tried again after a wait, and the other requests wait
   * with it.
   */
  async function fetchLogs(
    chainId: number,
    addresses: Array<Address>,
    from: bigint,
    to: bigint,
    onProgress: (done: number) => void,
  ) {
    const reader = client(chainId);
    const size = BigInt(Math.max(1, configOf(chainId).blockRange ?? 10_000));
    const logs: Array<PoolLog> = [];
    /** When requests may go out again after a rate limit. Shared by every worker. */
    let resumeAt = 0;

    async function range(fromBlock: bigint, toBlock: bigint, attempt = 0): Promise<void> {
      const wait = resumeAt - Date.now();
      if (wait > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, wait);
        });
      }
      let found: Array<unknown>;
      try {
        found = await reader.getLogs({
          address: addresses,
          events: POOL_EVENTS,
          fromBlock,
          toBlock,
        });
      } catch (error) {
        if (isRateLimit(error)) {
          // Smaller ranges would only mean more requests. Slow down instead.
          if (attempt >= RATE_LIMIT_RETRIES) {
            throw error;
          }
          resumeAt = Math.max(resumeAt, Date.now() + RATE_LIMIT_WAIT * 2 ** attempt);
          return range(fromBlock, toBlock, attempt + 1);
        }
        if (fromBlock === toBlock) {
          throw error;
        }
        const middle = fromBlock + (toBlock - fromBlock) / 2n;
        await range(fromBlock, middle);
        await range(middle + 1n, toBlock);
        return;
      }
      for (const log of found) {
        const parsed = parseLog(log);
        if (parsed) {
          logs.push(parsed);
        }
      }
    }

    const ranges: Array<[bigint, bigint]> = [];
    for (let start = from; start <= to; start += size) {
      ranges.push([start, start + size - 1n > to ? to : start + size - 1n]);
    }
    let next = 0;
    let done = 0;
    const worker = async () => {
      for (let entry = ranges[next++]; entry; entry = ranges[next++]) {
        const [start, end] = entry;
        await range(start, end);
        onProgress(++done / ranges.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(LOG_REQUESTS, ranges.length) }, worker));
    return logs;
  }

  /** A pool's two trees as the ASP publishes them: approved labels, and every commitment. */
  async function treeLeaves(chainId: number, pool: Pool) {
    const response = await request(`${configOf(chainId).aspUrl}/${chainId}/public/mt-leaves`, {
      headers: { "X-Pool-Scope": pool.scope.toString() },
    });
    if (!response.ok) {
      throw new Error(`The ASP answered ${response.status}.`);
    }
    const body: unknown = await response.json();
    return parseLeaves(body);
  }

  /** Which of these labels the ASP declined. Naming them tells the ASP they belong together. */
  async function declinedLabels(chainId: number, pool: Pool, labels: Array<string>) {
    if (labels.length === 0) {
      return [];
    }
    const response = await request(
      `${configOf(chainId).aspUrl}/${chainId}/public/deposits-by-label`,
      { headers: { "X-Pool-Scope": pool.scope.toString(), "X-Labels": labels.join(",") } },
    );
    if (!response.ok) {
      throw new Error(`The ASP answered ${response.status}.`);
    }
    const deposits: unknown = await response.json();
    if (!isArray(deposits)) {
      throw new Error("The ASP's answer could not be read.");
    }
    return deposits.flatMap((entry) =>
      isObject(entry) &&
      "label" in entry &&
      isString(entry.label) &&
      "reviewStatus" in entry &&
      entry.reviewStatus === "declined"
        ? [entry.label]
        : [],
    );
  }

  /** The ASP's approved labels for a pool, as decimal strings. */
  async function approvedLabels(chainId: number, pool: Pool) {
    return new Set((await treeLeaves(chainId, pool)).aspLeaves);
  }

  async function runScan(chainId: number) {
    const chain = chainOf(chainId);
    const started = session;
    const phrase = mnemonic;
    if (!phrase) {
      return;
    }
    let stage: ShieldedSyncStage = "notes";
    const report = (progress: number) => setSync(chain, { stage, status: "syncing", progress });

    try {
      report(0);
      const pools = await poolsOf(chainId);
      await readCache(chainId, pools);
      if (started !== session) {
        return;
      }
      const head = await client(chainId).getBlockNumber();
      const first = pools.reduce(
        (lowest, pool) => (pool.deploymentBlock < lowest ? pool.deploymentBlock : lowest),
        pools[0]?.deploymentBlock ?? head,
      );
      const from = chain.syncedTo === undefined ? first : chain.syncedTo + 1n;
      const logs =
        from <= head
          ? await fetchLogs(
              chainId,
              pools.map((pool) => pool.address),
              from,
              head,
              (done) => started === session && report(done),
            )
          : [];
      if (started !== session) {
        return;
      }

      // Keep what can no longer be reorganised away. The rest is read again next time.
      const final = head > REORG_DEPTH ? head - REORG_DEPTH : 0n;
      const settled = logs.filter((log) => log.blockNumber <= final);
      addLogs(chain.events, settled);
      if (chain.syncedTo === undefined || final > chain.syncedTo) {
        chain.syncedTo = final;
      }
      // Save when there is something new to keep, or enough blocks were ruled out.
      if (
        chain.cachedTo === undefined ||
        (chain.syncedTo > chain.cachedTo &&
          (settled.length > 0 || chain.syncedTo - chain.cachedTo >= CACHE_STRIDE))
      ) {
        void writeCache(chainId, pools);
      }

      const recent = new Map<string, PoolEvents>();
      addLogs(
        recent,
        logs.filter((log) => log.blockNumber > final),
      );
      /** A pool's final events, then the recent ones. */
      const eventsOf = (address: Address): PoolEvents => {
        const kept = chain.events.get(lower(address));
        const fresh = recent.get(lower(address));
        return {
          deposits: [...(kept?.deposits ?? []), ...(fresh?.deposits ?? [])],
          withdrawals: [...(kept?.withdrawals ?? []), ...(fresh?.withdrawals ?? [])],
          ragequits: [...(kept?.ragequits ?? []), ...(fresh?.ragequits ?? [])],
        };
      };

      const { AccountService, DataService } = await loadSdk();
      // The SDK's own data service refetches everything on every call. This
      // one answers from the events above.
      class ScannedEvents extends DataService {
        override async getDeposits(pool: PoolInfo) {
          return eventsOf(pool.address).deposits;
        }
        override async getWithdrawals(pool: PoolInfo) {
          return eventsOf(pool.address).withdrawals;
        }
        override async getRagequits(pool: PoolInfo) {
          return eventsOf(pool.address).ragequits;
        }
      }
      const { account, errors } = await AccountService.initializeWithEvents(
        new ScannedEvents([]),
        { mnemonic: phrase },
        pools.map((pool) => ({
          chainId,
          address: pool.address,
          scope: pool.scope,
          deploymentBlock: pool.deploymentBlock,
        })),
      );
      if (started !== session) {
        return;
      }
      // A pool that failed to load is absent, not empty. Show nothing rather than too little.
      const [failed] = errors;
      if (failed) {
        throw new Error(failed.reason);
      }

      stage = "transactions";
      report(0);
      const approved = new Map<bigint, Set<string>>();
      for (const [index, pool] of pools.entries()) {
        approved.set(pool.scope, await approvedLabels(chainId, pool));
        if (started !== session) {
          return;
        }
        report((index + 1) / pools.length);
      }

      // Asked only for deposits that are not approved, and only when the app chose to.
      const declined = new Set<string>();
      if (checkDeclined) {
        for (const pool of pools) {
          const accounts = account.account.poolAccounts.get(pool.scope) ?? [];
          const labels = approved.get(pool.scope) ?? NO_LABELS;
          const waiting = accounts
            .filter((entry) => poolAccountState(entry, labels) === "pending")
            .map((entry) => entry.label.toString());
          for (const label of await declinedLabels(chainId, pool, waiting)) {
            declined.add(label);
          }
          if (started !== session) {
            return;
          }
        }
      }
      // Who made each deposit: the only address its exit can be sent from.
      const depositors = new Map<string, Address>();
      const withdrawals: ChainState["withdrawals"] = new Map();
      for (const pool of pools) {
        const events = eventsOf(pool.address);
        for (const event of events.withdrawals) {
          withdrawals.set(event.spentNullifier, event.transactionHash);
        }
        for (const event of events.deposits) {
          depositors.set(`${pool.scope}:${event.label}`, getAddress(event.depositor));
        }
      }

      chain.account = account;
      chain.approved = approved;
      chain.declined = declined;
      chain.withdrawals = withdrawals;
      const exits: Array<ShieldedExit> = [];
      const exitSources: ChainState["exitSources"] = new Map();
      const now = Date.now();
      for (const [hash, at] of chain.submitted) {
        if (now - at >= SUBMITTED_LIFETIME) {
          chain.submitted.delete(hash);
        }
      }
      const latest = new Set<bigint>();
      const balances: Array<ShieldedTokenBalance> = [];
      let changed = false;
      for (const pool of pools) {
        const amounts = { spendable: 0n, pending: 0n, proving: 0n, incomplete: 0n, restricted: 0n };
        let held = false;
        const accounts = account.account.poolAccounts.get(pool.scope) ?? [];
        const labels = approved.get(pool.scope) ?? NO_LABELS;
        for (const poolAccount of accounts) {
          const state = poolAccountState(poolAccount, labels, declined);
          if (state) {
            const commitment = poolAccount.children.at(-1) ?? poolAccount.deposit;
            latest.add(commitment.hash);
            // On its way out through the relayer already: an exit now would race it.
            if (!chain.submitted.has(commitment.hash)) {
              const id = `${pool.scope}:${poolAccount.label}`;
              exits.push({
                id,
                token: pool.asset,
                amount: commitment.value,
                state,
                depositor: depositors.get(id),
              });
              exitSources.set(id, { pool, commitment });
            }
            // A withdrawal is on its way: these funds can't be spent again, and part may come back.
            amounts[chain.submitted.has(commitment.hash) ? "proving" : state] += commitment.value;
            held = true;
          }
          const key = lower(poolAccount.deposit.txHash);
          // Funds that left: withdrawn ones were approved, exited ones went back in public.
          const shown = state ?? (poolAccount.ragequit ? "restricted" : "spendable");
          // A new object only when the state moved, so the reference is stable in between.
          if (chain.transactions.get(key)?.state === shown) {
            continue;
          }
          chain.transactions.set(key, {
            kind: "shield",
            token: pool.asset,
            amount: poolAccount.deposit.value,
            state: shown,
          });
          changed = true;
        }
        if (held) {
          balances.push({ token: pool.asset, amounts });
        }
      }
      // A commitment that is no longer the latest was spent: the withdrawal landed.
      for (const hash of chain.submitted.keys()) {
        if (!latest.has(hash)) {
          chain.submitted.delete(hash);
        }
      }
      chain.exitSources = exitSources;
      if (!chain.exits || !sameExits(chain.exits, exits)) {
        chain.exits = exits;
        changed = true;
      }
      if (!chain.balances || !sameBalances(chain.balances, balances)) {
        chain.balances = balances;
        changed = true;
      }
      if (changed) {
        emit("balances");
      }
      setSync(chain, { stage: "transactions", status: "synced", progress: 1 });
    } catch (error) {
      if (started !== session) {
        return;
      }
      setSync(chain, { ...chain.sync, stage, status: "error", error: reason(error) });
    }
  }

  /** Scan a chain, or join the scan already running. Does nothing while the account is not unlocked. */
  function scan(chainId: number): Promise<void> {
    if (status !== "unlocked") {
      return Promise.resolve();
    }
    const chain = chainOf(chainId);
    if (!chain.scan) {
      const running: Promise<void> = runScan(chainId).finally(() => {
        if (chain.scan === running) {
          chain.scan = undefined;
        }
      });
      chain.scan = running;
    }
    return chain.scan;
  }

  /**
   * Scan with a head read from now on. A scan already running may have read
   * the head before the caller's transaction was mined, so it is followed by
   * one more, shared by everyone who asks meanwhile.
   */
  function freshScan(chainId: number): Promise<void> {
    if (status !== "unlocked") {
      return Promise.resolve();
    }
    const chain = chainOf(chainId);
    if (!chain.scan) {
      return scan(chainId);
    }
    if (!chain.rescan) {
      const started = session;
      const queued: Promise<void> = chain.scan.then(() => {
        if (chain.rescan === queued) {
          chain.rescan = undefined;
        }
        return started === session ? scan(chainId) : undefined;
      });
      chain.rescan = queued;
    }
    return chain.rescan;
  }

  function reservations(): Array<Reservation> {
    try {
      const stored: unknown = JSON.parse(storage.getItem(RESERVED_KEY) ?? "[]");
      return isArray(stored) ? stored.filter(isReservation) : [];
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
      if (entry.key === key && BigInt(entry.index) >= index) {
        index = BigInt(entry.index) + 1n;
      }
    }
    if (index - fromScan >= MAX_INDEXES_AHEAD) {
      throw new Error(
        "Several shields were started and not confirmed. Wait for them, or try again in half an hour.",
      );
    }
    storage.setItem(
      RESERVED_KEY,
      JSON.stringify([...live, { key, index: index.toString(), at: now }]),
    );
    return index;
  }

  /** Withdrawals proved in this session and not yet submitted, by operation id. */
  const proved = new Map<string, Proved>();
  let proofCount = 0;
  let prover: Promise<{ sdk: PrivacyPoolSDK }> | undefined;

  /** The SDK's prover with the circuit files loaded. They are downloaded once per session. */
  function loadProver() {
    if (!circuitsUrl) {
      throw new Error("Unshielding needs `circuitsUrl`, where the circuit files are served.");
    }
    if (!prover) {
      const loading = (async () => {
        const { Circuits, PrivacyPoolSDK } = await loadSdk();
        const circuits = new Circuits({ baseUrl: circuitsUrl });
        await circuits.initArtifacts("latest");
        return { sdk: new PrivacyPoolSDK(circuits) };
      })();
      // A failed download is tried again by the next proof.
      loading.catch(() => {
        if (prover === loading) {
          prover = undefined;
        }
      });
      prover = loading;
    }
    return prover;
  }

  function relayerOf(chainId: number) {
    const url = configOf(chainId).relayerUrl;
    if (!url) {
      throw new Error("Unshielding is not set up for this chain: it has no relayer.");
    }
    return url;
  }

  /** Ask the relayer, and read its answer with `parse`. */
  async function relayer<T>(
    chainId: number,
    path: string,
    parse: (answer: unknown) => T | undefined,
    body?: unknown,
  ): Promise<T> {
    const response = await request(
      `${relayerOf(chainId)}/relayer/${path}`,
      body === undefined
        ? undefined
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    const text = await response.text();
    let answer: unknown;
    try {
      answer = JSON.parse(text);
    } catch {
      // Not JSON. The status says enough.
    }
    if (!response.ok) {
      const why = refusalOf(answer);
      throw Object.assign(new Error(why ?? `The relayer answered ${response.status}.`), {
        status: response.status,
      });
    }
    const parsed = parse(answer);
    if (parsed === undefined) {
      throw new Error("The relayer's answer could not be read.");
    }
    return parsed;
  }

  /**
   * The relayer's price for a withdrawal. With a recipient it also signs a
   * fee commitment, which a proof is then bound to.
   */
  async function relayerQuote(draft: PrivateDraft, pool: Pool, withRecipient: boolean) {
    const [minWithdrawAmount, quote] = await Promise.all([
      relayer(
        draft.chainId,
        `details?chainId=${draft.chainId}&assetAddress=${pool.asset}`,
        parseMinimum,
      ),
      relayer(draft.chainId, "quote", parseQuote, {
        chainId: draft.chainId,
        amount: draft.amount.toString(),
        asset: pool.asset,
        recipient: withRecipient ? draft.recipient : undefined,
        extraGas: false,
      }),
    ]);
    const minimum = BigInt(minWithdrawAmount);
    if (draft.amount < minimum) {
      throw new Error(`The minimum is ${formatUnits(minimum, pool.decimals)}.`);
    }
    const feeBps = BigInt(quote.feeBPS);
    if (feeBps > pool.maxRelayFeeBps) {
      throw new Error("The relayer's fee is above what the pool allows. Try again later.");
    }
    const fee = (draft.amount * feeBps) / 10_000n;
    return {
      minimum,
      feeBps,
      quote: { fee, received: draft.amount - fee },
      commitment: quote.feeCommitment,
    };
  }

  /**
   * The deposit an unshield spends. A withdrawal spends one deposit, so the
   * amount has to fit in one, and what it leaves behind has to be worth
   * withdrawing later.
   */
  function sourceFor(chainId: number, pool: Pool, amount: bigint, minimum: bigint) {
    const chain = chainOf(chainId);
    const approved = chain.approved.get(pool.scope) ?? new Set<string>();
    const accounts = chain.account?.account.poolAccounts.get(pool.scope) ?? [];
    const spendable: Array<AccountCommitment> = [];
    for (const account of accounts) {
      if (poolAccountState(account, approved) !== "spendable") {
        continue;
      }
      const commitment = account.children.at(-1) ?? account.deposit;
      if (!chain.submitted.has(commitment.hash)) {
        spendable.push(commitment);
      }
    }
    spendable.sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));

    const show = (value: bigint) => formatUnits(value, pool.decimals);
    const largest = spendable.at(-1)?.value ?? 0n;
    if (amount > largest) {
      const total = spendable.reduce((sum, commitment) => sum + commitment.value, 0n);
      throw new Error(
        amount > total
          ? "Not enough spendable balance."
          : `An unshield spends one deposit. The most you can unshield at once is ${show(largest)}.`,
      );
    }
    const fits = spendable.filter((commitment) => commitment.value >= amount);
    const source = fits.find(({ value }) => value === amount || value - amount >= minimum);
    if (!source) {
      // The amount fits the largest deposit, so there is a smallest one it fits.
      const value = fits[0]?.value ?? largest;
      throw new Error(
        `That would leave ${show(value - amount)} behind, less than the minimum of ${show(minimum)}. Unshield ${show(value)} instead.`,
      );
    }
    return source;
  }

  function requireUnlocked() {
    if (status !== "unlocked") {
      throw new Error("Unlock the private account first.");
    }
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
      chain.rescan = undefined;
      chain.account = undefined;
      chain.approved = new Map();
      chain.declined = new Set();
      chain.exits = undefined;
      chain.withdrawals = new Map();
      chain.exitSources = new Map();
      chain.submitted = new Map();
    }
    proved.clear();
    emit("sync");
    emit("balances");
  }

  function scanAll() {
    for (const chainId of Object.keys(chains)) {
      void scan(Number(chainId));
    }
  }

  function open(phrase: string) {
    mnemonic = phrase;
    status = "unlocked";
    emit("account");
    scanAll();
    if (pollInterval > 0) {
      poll = setInterval(scanAll, pollInterval);
    }
  }

  async function setAccount(phrase: string, password: string) {
    if (!password) {
      throw new Error("Choose a password.");
    }
    const stored = await encryptPhrase(phrase, password);
    if (status === "unlocked") {
      close();
    }
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
        if (status === "unlocked") {
          return;
        }
        const stored = storage.getItem(ACCOUNT_KEY);
        if (!stored) {
          throw new Error("There is no private account to unlock.");
        }
        const phrase = await decryptPhrase(stored, password);
        // Another unlock may have finished while this one was decrypting.
        if (mnemonic === undefined) {
          open(phrase);
        }
      },
      lock() {
        if (status !== "unlocked") {
          return;
        }
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
    sync: freshScan,

    // Nothing in Privacy Pools v1 is ever `incomplete`.
    async retryProofs() {},

    async quoteShield(draft) {
      if (draft.amount <= 0n) {
        throw new Error("Enter an amount.");
      }
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
      const { scope } = pool;
      // The next index comes from the pool's history. Without all of it, an index could be used twice.
      if (!chain.account?.isScopeComplete(scope)) {
        await scan(draft.chainId);
      }
      if (started !== session) {
        throw new Error("The private account was locked.");
      }
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
        reserveIndex(draft.chainId, pool, fromScan),
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

    async quote(draft) {
      if (draft.amount <= 0n) {
        throw new Error("Enter an amount.");
      }
      const pool = await poolFor(draft.chainId, draft.token);
      const { minimum, quote } = await relayerQuote(draft, pool, false);
      // Without the account there is no balance to check the amount against.
      if (chainOf(draft.chainId).account) {
        sourceFor(draft.chainId, pool, draft.amount, minimum);
      }
      return quote;
    },

    async prove(draft, { onStage, signal }) {
      requireUnlocked();
      if (signal?.aborted) {
        throw signal.reason;
      }
      if (draft.amount <= 0n) {
        throw new Error("Enter an amount.");
      }
      const started = session;
      const { chainId } = draft;
      const chain = chainOf(chainId);
      const stillOpen = () => {
        if (started !== session) {
          throw new Error("The private account was locked.");
        }
      };

      onStage("loading-circuits");
      const pool = await abortable(poolFor(chainId, draft.token), signal);
      if (!chain.account) {
        await abortable(scan(chainId), signal);
      }
      stillOpen();
      const account = chain.account;
      if (!account) {
        throw new Error("Couldn't read the pool's history. Scan again before unshielding.");
      }
      const { sdk } = await abortable(loadProver(), signal);
      const { calculateContext, generateMerkleProof } = await loadSdk();

      // The proof is bound to the relayer's commitment, which lasts about a
      // minute. Ask for it last, once everything slow is loaded.
      const [{ minimum, feeBps, quote, commitment }, leaves, aspRoot] = await abortable(
        Promise.all([
          relayerQuote(draft, pool, true),
          treeLeaves(chainId, pool),
          client(chainId)
            .readContract({
              address: configOf(chainId).entrypoint,
              abi: ASP_ROOT_ABI,
              functionName: "latestRoot",
            })
            .then((root) => {
              if (!isBigint(root)) {
                throw new Error("The approval list on chain could not be read.");
              }
              return root;
            }),
        ]),
        signal,
      );
      stillOpen();
      checkCommitment(commitment, draft, feeBps);
      const source = sourceFor(chainId, pool, draft.amount, minimum);

      let stateProof, aspProof;
      try {
        stateProof = generateMerkleProof(leaves.stateTreeLeaves.map(BigInt), source.hash);
        aspProof = generateMerkleProof(leaves.aspLeaves.map(BigInt), source.label);
      } catch {
        throw new Error("The ASP's records are behind the chain. Try again in a minute.");
      }
      // The pool only accepts the approval list that is on chain right now.
      if (BigInt(aspProof.root) !== aspRoot) {
        throw new Error("The approval list is being updated. Try again in a minute.");
      }

      const secrets = account.createWithdrawalSecrets(source);
      const context = calculateContext(
        { processooor: configOf(chainId).entrypoint, data: commitment.withdrawalData },
        pool.scope,
      );

      onStage("proving");
      const proof = await abortable(
        sdk.proveWithdrawal(source, {
          context: BigInt(context),
          withdrawalAmount: draft.amount,
          stateMerkleProof: stateProof,
          aspMerkleProof: aspProof,
          stateRoot: rootOf(stateProof),
          stateTreeDepth: TREE_DEPTH,
          aspRoot: rootOf(aspProof),
          aspTreeDepth: TREE_DEPTH,
          newNullifier: secrets.nullifier,
          newSecret: secrets.secret,
        }),
        signal,
      );

      onStage("verifying");
      if (!(await abortable(sdk.verifyWithdrawal(proof), signal))) {
        throw new Error("The proof did not verify. Nothing was sent.");
      }
      stillOpen();

      const id = `privacy-pools-proof-${++proofCount}`;
      proved.set(id, { session: started, pool, source, proof, feeCommitment: commitment });
      return { id, draft, quote, expiresAt: Date.now() + PROOF_LIFETIME };
    },

    async submit(operation) {
      requireUnlocked();
      const entry = proved.get(operation.id);
      if (!entry || entry.session !== session) {
        throw new Error("This proof can't be used. Prove again.");
      }
      const { draft } = operation;
      const { pool, source, proof } = entry;
      // One submit per proof, even if this one fails halfway: a second could pay twice.
      proved.delete(operation.id);
      if (Date.now() > operation.expiresAt) {
        throw new Error("The proof expired. Prove again.");
      }

      let { feeCommitment } = entry;
      if (feeCommitment.expiration - Date.now() < COMMITMENT_MARGIN) {
        // The relayer's promise ran out. A new one fits this proof only if it says the same thing.
        const { commitment } = await relayerQuote(draft, pool, true);
        if (
          !commitment ||
          lower(commitment.withdrawalData) !== lower(feeCommitment.withdrawalData)
        ) {
          throw new Error("The relayer's fee changed. Prove again.");
        }
        feeCommitment = commitment;
      }

      const chain = chainOf(draft.chainId);
      let answer: ReturnType<typeof parseRelayAnswer>;
      try {
        answer = await relayer(draft.chainId, "request", parseRelayAnswer, {
          withdrawal: {
            processooor: configOf(draft.chainId).entrypoint,
            data: feeCommitment.withdrawalData,
          },
          publicSignals: proof.publicSignals,
          proof: { pi_a: proof.proof.pi_a, pi_b: proof.proof.pi_b, pi_c: proof.proof.pi_c },
          scope: pool.scope.toString(),
          chainId: draft.chainId,
          feeCommitment,
        });
      } catch (error) {
        const status =
          isObject(error) && "status" in error && isNumber(error.status) ? error.status : undefined;
        // The relayer said no. Nothing was sent.
        if (status !== undefined && status < 500) {
          throw error;
        }
        // No clear answer: a timeout, a gateway error, a dropped connection.
        // The relayer may have sent it all the same, so look on chain.
        chain.submitted.set(source.hash, Date.now());
        // The proof's second public signal is the nullifier the withdrawal spends.
        const spent = proof.publicSignals[1];
        if (spent === undefined) {
          throw new Error("The proof has no nullifier to look for on chain.", { cause: error });
        }
        const nullifier = BigInt(spent);
        const until = Date.now() + RELAY_WATCH;
        for (;;) {
          await freshScan(draft.chainId);
          if (entry.session !== session) {
            throw new Error("The private account was locked.", { cause: error });
          }
          const hash = chain.withdrawals.get(nullifier);
          if (hash) {
            return { hash };
          }
          if (Date.now() >= until) {
            break;
          }
          await new Promise((resolve) => {
            setTimeout(resolve, RELAY_WATCH_INTERVAL);
          });
        }
        throw new Error(
          "The relayer gave no answer, and the withdrawal is not on chain yet. It may still arrive: check the balance again in a few minutes before trying again.",
          { cause: error },
        );
      }
      if (!answer.success || !answer.txHash) {
        throw new Error(answer.error || "The relayer did not send the withdrawal.");
      }

      if (entry.session === session) {
        chain.submitted.set(source.hash, Date.now());
        void freshScan(draft.chainId);
      }
      return { hash: answer.txHash };
    },
    getExits: (chainId) => chainOf(chainId).exits,

    async prepareExit(chainId, id, { onStage, signal }) {
      requireUnlocked();
      if (signal?.aborted) {
        throw signal.reason;
      }
      const started = session;
      const source = chainOf(chainId).exitSources.get(id);
      if (!source) {
        throw new Error("These funds are no longer there to exit. Scan again.");
      }
      const { pool, commitment } = source;

      onStage("loading-circuits");
      const { sdk } = await abortable(loadProver(), signal);
      onStage("proving");
      const proof = await abortable(
        sdk.proveCommitment(
          commitment.value,
          commitment.label,
          commitment.nullifier,
          commitment.secret,
        ),
        signal,
      );
      onStage("verifying");
      if (!(await abortable(sdk.verifyCommitment(proof), signal))) {
        throw new Error("The proof did not verify. Nothing was sent.");
      }
      if (started !== session) {
        throw new Error("The private account was locked.");
      }

      const { pi_a, pi_b, pi_c } = proof.proof;
      const [commitmentHash, nullifierHash, value, label, ...extra] =
        proof.publicSignals.map(BigInt);
      if (
        commitmentHash === undefined ||
        nullifierHash === undefined ||
        value === undefined ||
        label === undefined ||
        extra.length > 0
      ) {
        throw unexpectedProof();
      }
      return {
        transaction: {
          to: pool.address,
          data: encodeFunctionData({
            abi: POOL_ABI,
            functionName: "ragequit",
            args: [
              {
                pA: pair(pi_a),
                pB: [flipped(pi_b[0]), flipped(pi_b[1])],
                pC: pair(pi_c),
                pubSignals: [commitmentHash, nullifierHash, value, label],
              },
            ],
          }),
          value: 0n,
        },
      };
    },
  };
}
