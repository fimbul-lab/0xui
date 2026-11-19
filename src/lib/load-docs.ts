import { getCollection } from "astro:content";
import registry from "../../registry.json";
import type { DocPage, RegistryItem } from "./agent-docs";

export const registryItems: RegistryItem[] = registry.items;

/** Every docs page except the landing page. */
export async function loadDocs(): Promise<DocPage[]> {
  const docs = await getCollection("docs");
  return docs
    .filter((doc) => doc.id !== "index")
    .map((doc) => ({
      id: doc.id,
      title: doc.data.title,
      description: doc.data.description ?? "",
      body: doc.body ?? "",
    }));
}

export function text(body: string, type = "text/plain") {
  return new Response(body, { headers: { "Content-Type": `${type}; charset=utf-8` } });
}
