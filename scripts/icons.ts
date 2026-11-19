// Draws the icons that cannot be the SVG favicon, from the 0xui mark.
//
//   bun run icons
//
// public/favicon.ico            browsers without SVG favicons, and bare /favicon.ico requests
// public/apple-touch-icon.png   iOS home screen
// public/icon-192.png, -512.png Android, through public/site.webmanifest
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { c, mark } from "./readme/lib";

const out = (name: string) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));

/**
 * The white mark on the dark background, in a 100-unit square. `fill` is how
 * much of the height the mark takes, and `radius` rounds the corners: the
 * favicon is rounded like public/favicon.svg, the others are cropped by the OS.
 */
function draw(size: number, fill: number, radius = 0): Promise<Buffer> {
  const height = 100 * fill;
  const width = (58 / 73.4667) * height;
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}"><rect width="100" height="100" rx="${radius}" fill="${c.bg}"/>${mark((100 - width) / 2, (100 - height) / 2, height)}</svg>`;
  return sharp(Buffer.from(source)).png().toBuffer();
}

/** An .ico file holding PNG images, which every browser since IE 11 reads. */
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0); // width
    entry.writeUInt8(size, 1); // height
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

const favicon = await Promise.all(
  [16, 32, 48].map(async (size) => ({ size, png: await draw(size, 0.7347, 25.6) })),
);
writeFileSync(out("favicon.ico"), ico(favicon));
writeFileSync(out("apple-touch-icon.png"), await draw(180, 0.6));
writeFileSync(out("icon-192.png"), await draw(192, 0.56));
writeFileSync(out("icon-512.png"), await draw(512, 0.56));
console.log("icons written to public/");
