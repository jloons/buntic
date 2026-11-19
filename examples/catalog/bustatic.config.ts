import { defineConfig } from "../../src/index.ts";

export default defineConfig({
  port: 3334,
  minify: true,
  defaultStorage: process.env.STORAGE_BACKEND || "local",
  site: {
    url: "https://catalog.bustatic.dev",
    title: "Bustatic Showcase Catalog",
    description: "Catálogo de demostración integrado con OCI Registry, S3, PostgreSQL y Redis",
  },
  seo: {
    sitemap: true,
    robots: true,
  },
});
