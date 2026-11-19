import { defineRouteMiddleware } from "@astrojs/starlight/route-data";
import { unlistedPages } from "./docs-nav.mjs";

// Unlisted pages (the shielded preview, see src/docs-nav.mjs) stay out of
// search, which also keeps them out of the search_docs WebMCP tool, and say
// what they are at the top. /shielded/ explains it in its own text.
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  if (!unlistedPages.has(route.id)) return;

  route.entry.data.pagefind = false;
  if (route.id === "shielded") return;
  route.entry.data.banner ??= {
    content:
      'Preview, unlisted. Runs on a mock engine only. <a href="/shielded/">About the shielded preview</a>',
  };
});
