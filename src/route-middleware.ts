import { defineRouteMiddleware } from "@astrojs/starlight/route-data";
import { unlistedPages } from "./docs-nav.mjs";
import {
  breadcrumbJsonLd,
  ogImage,
  ogSize,
  pageTitle,
  shareTitle,
  siteJsonLd,
  siteName,
} from "./lib/seo";

type Head = App.Locals["starlightRoute"]["head"];

/** Sets a `<meta>` by its `name` or `property`, replacing the one Starlight wrote if there is one. */
function meta(head: Head, key: "name" | "property", id: string, content: string) {
  const found = head.find((tag) => tag.tag === "meta" && tag.attrs?.[key] === id);
  if (found) {
    found.attrs = { ...found.attrs, content };
  } else {
    head.push({ tag: "meta", attrs: { [key]: id, content }, content: "" });
  }
}

function jsonLd(head: Head, data: unknown) {
  head.push({
    tag: "script",
    attrs: { type: "application/ld+json" },
    // Written into the page as is, so a "<" must not be able to end the script.
    content: JSON.stringify(data).replaceAll("<", String.raw`\u003c`),
  });
}

export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  const { head, id } = route;
  const { title } = route.entry.data;
  const description = route.entry.data.description ?? "";
  const missing = id === "404";
  const unlisted = unlistedPages.has(id);

  // Titles and the link preview. See src/lib/seo.ts.
  if (!missing) {
    const tag = head.find((entry) => entry.tag === "title");
    if (tag) {
      tag.content = pageTitle(id, title);
    }
    meta(head, "property", "og:title", shareTitle(id, title));
  }
  if (!id) {
    meta(head, "property", "og:type", "website");
  }
  const image = ogImage(id, !missing);
  meta(head, "property", "og:image", image);
  meta(head, "property", "og:image:type", "image/png");
  meta(head, "property", "og:image:width", String(ogSize.width));
  meta(head, "property", "og:image:height", String(ogSize.height));
  meta(
    head,
    "property",
    "og:image:alt",
    !id || missing ? `${siteName}: Web3 components you own.` : `${title}. ${description}`,
  );
  meta(head, "name", "twitter:image", image);

  if (missing || unlisted) {
    meta(head, "name", "robots", "noindex");
  } else if (!id) {
    jsonLd(head, siteJsonLd(description));
  } else {
    jsonLd(head, breadcrumbJsonLd(id, title));
  }

  // Unlisted pages (the shielded preview, see src/docs-nav.mjs) stay out of
  // search engines (above, and the sitemap in astro.config.mjs) and out of the
  // site search, which also keeps them out of the search_docs WebMCP tool, and
  // say what they are at the top. /shielded/ explains it in its own text.
  if (!unlisted) {
    return;
  }

  route.entry.data.pagefind = false;
  if (id === "shielded") {
    return;
  }
  route.entry.data.banner ??= {
    content:
      'Preview, unlisted. Runs on a mock engine only. <a href="/shielded/">About the shielded preview</a>',
  };
});
