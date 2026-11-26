// The social card (og:image) of every docs page, drawn in src/lib/og.ts.
import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import sharp from "sharp";
import { registryItems } from "@/lib/load-docs";
import { ogCard } from "@/lib/og";
import type { OgPage } from "@/lib/og";

export const getStaticPaths = (async () => {
  const docs = await getCollection("docs");
  return docs.map((doc) => {
    const [section, name] = doc.id.split("/");
    const page: OgPage = {
      id: doc.id,
      title: doc.data.title,
      description: doc.data.description ?? "",
      installable:
        (section === "components" || section === "blocks") &&
        registryItems.some((item) => item.name === name),
    };
    return { params: { slug: doc.id }, props: { page } };
  });
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ page: OgPage }> = async ({ props }) => {
  // Lossless, and opaque: the card fills its frame, so drop the alpha channel.
  // Flat colour compresses well, so the slowest setting halves the file.
  const png = await sharp(Buffer.from(ogCard(props.page)))
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
};
