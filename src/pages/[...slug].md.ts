import type { APIRoute, GetStaticPaths } from "astro";
import { pageMarkdown } from "@/lib/agent-docs";
import type { DocPage } from "@/lib/agent-docs";
import { loadDocs, registryItems, text } from "@/lib/load-docs";

export const getStaticPaths = (async () => {
  const docs = await loadDocs();
  return docs.map((page) => ({ params: { slug: page.id }, props: { page, docs } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ page: DocPage; docs: Array<DocPage> }> = ({ props }) =>
  text(pageMarkdown(props.page, props.docs, registryItems), "text/markdown");
