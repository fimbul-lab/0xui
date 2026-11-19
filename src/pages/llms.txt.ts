import type { APIRoute } from "astro";
import { llmsTxt } from "@/lib/agent-docs";
import { loadDocs, registryItems, text } from "@/lib/load-docs";

export const GET: APIRoute = async () => text(llmsTxt(await loadDocs(), registryItems));
