import type { APIRoute, GetStaticPaths } from "astro";
import { text } from "@/lib/load-docs";
import { allComponentDocs } from "@/lib/props";
import type { ComponentDoc } from "@/lib/props";

export const getStaticPaths = (() =>
  allComponentDocs().map((doc) => ({
    params: { name: doc.name },
    props: { doc },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute<{ doc: ComponentDoc }> = ({ props }) =>
  text(`${JSON.stringify(props.doc, null, 2)}\n`, "application/json");
