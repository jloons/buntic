import { defineConfig } from "bustatic";

export default defineConfig({
  port: 3000,
  minify: true,
  site: {
    url: "https://example.com",
    title: "Mi Sitio",
    description: "Sitio web estático generado con Bustatic",
  },
  seo: {
    sitemap: true,
    robots: true,
  },
});
