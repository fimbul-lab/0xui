import { setupServer } from "msw/node";
import { rpcNodes } from "./rpc";

/**
 * Intercepts every request tests make. test/setup.ts starts it, and a request
 * no handler answers fails the test. It always answers the fake JSON-RPC nodes
 * from test/rpc.ts; add other handlers with `server.use(…)`, which reset after
 * each test.
 */
export const server = setupServer(rpcNodes);
