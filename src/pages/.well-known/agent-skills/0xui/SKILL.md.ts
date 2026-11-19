import type { APIRoute } from "astro";
import skill from "../../../../../skills/0xui/SKILL.md?raw";
import { text } from "@/lib/load-docs";

export const GET: APIRoute = () => text(skill, "text/markdown");
