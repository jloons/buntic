import { join } from "node:path";
import { existsSync } from "node:fs";
import type { ResolvedConfig } from "../types.ts";

export function generateRobotsTxt(config: ResolvedConfig): string | null {
  if (config.seo?.robots === false) {
    return null;
  }

  // If user already has a robots.txt in public/, respect it
  const existingInPublic = join(config.publicDir, "robots.txt");
  if (existsSync(existingInPublic)) {
    return null;
  }

  const siteUrl = config.site?.url ? config.site.url.replace(/\/+$/, "") : "";
  const robotsOpt = typeof config.seo?.robots === "object" ? config.seo.robots : {};

  const allows = robotsOpt.allow || ["/"];
  const disallows = robotsOpt.disallow || [];

  const lines: string[] = ["User-agent: *"];

  for (const allow of allows) {
    lines.push(`Allow: ${allow}`);
  }

  for (const disallow of disallows) {
    lines.push(`Disallow: ${disallow}`);
  }

  if (siteUrl && config.seo?.sitemap !== false) {
    lines.push("");
    lines.push(`Sitemap: ${siteUrl}/sitemap.xml`);
  }

  lines.push("");
  return lines.join("\n");
}
