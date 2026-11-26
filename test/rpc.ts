import { http, HttpResponse } from "msw";

/**
 * Canned JSON-RPC responses by method name. A function receives the params.
 * Throw `{ code, message }` from a function to return a JSON-RPC error, e.g.
 * `{ code: 4001 }` for a user rejection.
 */
export type RpcResponses = Record<string, unknown | ((params: any) => unknown)>;

async function respond(rpc: RpcResponses, method: string, params: unknown) {
  if (!(method in rpc)) {
    throw new Error(`RPC method not mocked: ${method}`);
  }
  const response = rpc[method];
  return typeof response === "function" ? response(params) : response;
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
    const { id, method, params } = (await request.json()) as {
      id: number;
      method: string;
      params: unknown;
    };
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
