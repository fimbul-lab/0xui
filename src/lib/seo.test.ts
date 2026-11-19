import { describe, expect, it } from "vitest";
import { breadcrumbJsonLd, ogImage, pageTitle, shareTitle, siteJsonLd } from "./seo";

describe("pageTitle", () => {
  it("leads the landing page with the name and says what 0xui is", () => {
    expect(pageTitle("", "0xui")).toBe("0xui: Web3 React components for wagmi, viem and shadcn");
  });

  it("says what a component or block is", () => {
    expect(pageTitle("components/balance", "Balance")).toBe(
      "Balance – React web3 component | 0xui",
    );
    expect(pageTitle("blocks/swap", "Swap")).toBe("Swap – React web3 block | 0xui");
  });

  it("does not call a utility web3", () => {
    expect(pageTitle("components/copy-button", "Copy Button")).toBe(
      "Copy Button – React component | 0xui",
    );
  });

  it("names the section overviews for what they list", () => {
    expect(pageTitle("components", "Components")).toBe("Web3 React components | 0xui");
    expect(pageTitle("blocks", "Blocks")).toBe("Web3 React blocks | 0xui");
  });

  it("leaves guides as they are", () => {
    expect(pageTitle("getting-started/installation", "Installation")).toBe("Installation | 0xui");
    expect(pageTitle("shielded", "Shielded (preview)")).toBe("Shielded (preview) | 0xui");
  });

  it("fits a search result, even for the longest name", () => {
    const longest = pageTitle(
      "components/shielded-transaction-status",
      "Shielded Transaction Status",
    );
    expect(longest.length).toBeLessThanOrEqual(60);
  });
});

describe("shareTitle", () => {
  it("is the title without the site name, which a link preview shows separately", () => {
    expect(shareTitle("components/balance", "Balance")).toBe("Balance – React web3 component");
  });
});

describe("ogImage", () => {
  it("points at the page's card", () => {
    expect(ogImage("components/balance")).toBe("https://0xui.io/og/components/balance.png");
    expect(ogImage("")).toBe("https://0xui.io/og/index.png");
  });

  it("falls back to the landing page's card for a page without one", () => {
    expect(ogImage("404", false)).toBe("https://0xui.io/og/index.png");
  });
});

describe("breadcrumbJsonLd", () => {
  const names = (id: string, title: string) =>
    (breadcrumbJsonLd(id, title).itemListElement as { name: string; item: string }[]).map(
      (step) => [step.name, step.item],
    );

  it("goes through the section overview", () => {
    expect(names("components/balance", "Balance")).toEqual([
      ["0xui", "https://0xui.io/"],
      ["Components", "https://0xui.io/components/"],
      ["Balance", "https://0xui.io/components/balance/"],
    ]);
  });

  it("skips a section that has no page of its own", () => {
    expect(names("getting-started/installation", "Installation")).toEqual([
      ["0xui", "https://0xui.io/"],
      ["Installation", "https://0xui.io/getting-started/installation/"],
    ]);
  });

  it("ends at the overview on the overview", () => {
    expect(names("blocks", "Blocks")).toEqual([
      ["0xui", "https://0xui.io/"],
      ["Blocks", "https://0xui.io/blocks/"],
    ]);
  });
});

describe("siteJsonLd", () => {
  it("describes the site, its publisher and the repository", () => {
    const graph = siteJsonLd("About.")["@graph"] as { "@type": string }[];
    expect(graph.map((node) => node["@type"])).toEqual([
      "WebSite",
      "Organization",
      "SoftwareSourceCode",
    ]);
  });
});
