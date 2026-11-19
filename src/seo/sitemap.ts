import { join } from "node:path";
import { existsSync } from "node:fs";
import type { PageRouteInfo, ResolvedConfig } from "../types.ts";

export function generateSitemapXml(
  routes: PageRouteInfo[],
  config: ResolvedConfig
): string | null {
  if (config.seo?.sitemap === false) {
    return null;
  }

  // If user already has a sitemap.xml in public/, respect it
  const existingInPublic = join(config.publicDir, "sitemap.xml");
  if (existsSync(existingInPublic)) {
    return null;
  }

  const siteUrl = config.site?.url ? config.site.url.replace(/\/+$/, "") : "";
  if (!siteUrl) {
    return null;
  }

  const today = new Date().toISOString().split("T")[0];

  const urlsXml = routes.map((route) => {
    const loc = route.urlPath === "/" ? `${siteUrl}/` : `${siteUrl}${route.urlPath}`;
    const priority = route.urlPath === "/" ? "1.0" : "0.8";

    return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlsXml.join("\n")}
</urlset>
`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
