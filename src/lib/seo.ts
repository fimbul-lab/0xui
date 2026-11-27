// What search engines and link previews read: titles, the social card and
// structured data. Pure functions, applied to each page's <head> in
// src/route-middleware.ts.

import { groupOf } from "../docs-nav.mjs";
import { site } from "./agent-docs";

export const siteName = "0xui";
export const repository = "https://github.com/fimbul-lab/0xui";

/** Size of the social cards drawn in ./og.ts. */
export const ogSize = { width: 1200, height: 630 };

const homeTitle = "0xui: Web3 React components for wagmi, viem and shadcn";

/** Titles of the section overviews, which are one generic word on the page itself. */
function overviewTitle(id: string) {
  switch (id) {
    case "components":
      return "Web3 React components";
    case "blocks":
      return "Web3 React blocks";
    default:
      return undefined;
  }
}

function isOverview(section: string): section is "components" | "blocks" {
  return section === "components" || section === "blocks";
}

/**
 * The page's title for a search result or a link preview, without the site
 * name. Says what the page is, since "Balance" alone could be anything.
 *
 * @param id Starlight route id, like `components/balance`. The landing page is `""`.
 */
export function shareTitle(id: string, title: string): string {
  if (!id) {
    return homeTitle;
  }
  const [section, name] = id.split("/");
  if (!name) {
    return overviewTitle(id) ?? title;
  }
  if (section === "blocks") {
    return `${title} – React web3 block`;
  }
  if (section === "components") {
    // Utilities are plain UI (a copy button, a dialog), not web3.
    return `${title} – ${groupOf(name) === "Utilities" ? "React component" : "React web3 component"}`;
  }
  return title;
}

/** The page's `<title>`. */
export function pageTitle(id: string, title: string): string {
  return id ? `${shareTitle(id, title)} | ${siteName}` : homeTitle;
}

/** Absolute URL of a page's social card. Pages outside the docs collection, like the 404, get the landing page's. */
export function ogImage(id: string, exists = true): string {
  return `${site}/og/${exists && id ? id : "index"}.png`;
}

/** Structured data for the landing page: the site, who publishes it, and the code. */
export function siteJsonLd(description: string) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${site}/#website`,
        url: `${site}/`,
        name: siteName,
        description,
        publisher: { "@id": `${site}/#publisher` },
      },
      {
        "@type": "Organization",
        "@id": `${site}/#publisher`,
        name: "Fimbul Labs",
        url: "https://fimbul.io",
      },
      {
        "@type": "SoftwareSourceCode",
        name: siteName,
        description,
        url: `${site}/`,
        codeRepository: repository,
        programmingLanguage: "TypeScript",
        runtimePlatform: "React",
        publisher: { "@id": `${site}/#publisher` },
      },
    ],
  };
}

/**
 * Breadcrumbs for a docs page, like 0xui › Components › Balance. Only
 * sections with an overview page are a step: "Getting started" has none.
 */
export function breadcrumbJsonLd(id: string, title: string) {
  const [section, name] = id.split("/");
  const steps: Array<{ name: string; url: string }> = [{ name: siteName, url: `${site}/` }];
  if (section && name && isOverview(section)) {
    steps.push({
      name: section === "components" ? "Components" : "Blocks",
      url: `${site}/${section}/`,
    });
  }
  steps.push({ name: title, url: `${site}/${id}/` });
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: steps.map((step, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: step.name,
      item: step.url,
    })),
  };
}
