import { defineConfig } from "buntic";

export default defineConfig({
  port: 3000,
  minify: true,
  site: {
    url: "https://example.com",
    title: "Mi Sitio",
    description: "Sitio web estático generado con Buntic",
  },
  seo: {
    sitemap: true,
    robots: true,
  },
});
