import type { APIRoute } from "astro";
import { llmsFullTxt } from "@/lib/agent-docs";
import { loadDocs, registryItems, text } from "@/lib/load-docs";

export const GET: APIRoute = async () => text(llmsFullTxt(await loadDocs(), registryItems));
