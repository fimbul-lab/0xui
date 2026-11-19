import { createHash } from "node:crypto";
import type { APIRoute } from "astro";
import skill from "../../../../skills/0xui/SKILL.md?raw";
import { text } from "@/lib/load-docs";

// https://github.com/cloudflare/agent-skills-discovery-rfc (v0.2.0)
const description = skill.match(/^description: (.*)$/m)?.[1] ?? "";

export const GET: APIRoute = () =>
  text(
    JSON.stringify(
      {
        $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
        skills: [
          {
            name: "0xui",
            type: "skill-md",
            description,
            url: "/.well-known/agent-skills/0xui/SKILL.md",
            digest: `sha256:${createHash("sha256").update(skill).digest("hex")}`,
          },
        ],
      },
      null,
      2,
    ),
    "application/json",
  );
