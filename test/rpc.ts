import { http, HttpResponse } from "msw";

/**
 * Canned JSON-RPC responses by method name. A function receives the params.
 * Throw `{ code, message }` from a function to return a JSON-RPC error, e.g.
 * `{ code: 4001 }` for a user rejection.
 */
export type RpcResponses = Record<string, unknown>;

/** A canned response that is a function: it's called with the request's params. */
const isHandler = (response: unknown): response is (params: unknown) => unknown =>
  typeof response === "function";

async function respond(rpc: RpcResponses, method: string, params: unknown) {
  if (!(method in rpc)) {
    throw new Error(`RPC method not mocked: ${method}`);
  }
  const response = rpc[method];
  return isHandler(response) ? response(params) : response;
}

/** The id, method and params of a JSON-RPC request body. */
function parseRpcRequest(request: unknown) {
  if (
    typeof request !== "object" ||
    request === null ||
    !("method" in request) ||
    typeof request.method !== "string"
  ) {
    throw new Error(`Not a JSON-RPC request: ${JSON.stringify(request)}`);
  }
  return {
    id: "id" in request ? request.id : undefined,
    method: request.method,
    params: "params" in request ? request.params : undefined,
  };
}

const nodes: Array<RpcResponses> = [];

/**
 * The MSW handler for every node `serveRpc` starts. It outlives the test that
 * started a node, so a config's background polling still gets answers after
 * its test ends instead of failing the next one.
 */
export const rpcNodes = http.post<{ node: string }>(
  "https://rpc.test/:node",
  async ({ params: { node }, request }) => {
    const rpc = nodes[Number(node)];
    if (!rpc) {
      return HttpResponse.json({ error: `No node ${node}` }, { status: 404 });
    }
    const { id, method, params } = parseRpcRequest(await request.json());
    try {
      const result = await respond(rpc, method, params);
      return HttpResponse.json({ jsonrpc: "2.0", id, result });
    } catch (error) {
      const {
        code = -32_603,
        message = String(error),
        data,
      } = error as { code?: number; message?: string; data?: unknown };
      return HttpResponse.json({ jsonrpc: "2.0", id, error: { code, message, data } });
    }
  },
);

/** Start a JSON-RPC node that answers from `rpc`, and return its URL. */
export function serveRpc(rpc: RpcResponses) {
  nodes.push(rpc);
  return `https://rpc.test/${nodes.length - 1}`;
}
