import { defineConfig } from "../../src/index.ts";

export default defineConfig({
  port: 3000,
  minify: true,
  site: {
    url: "https://simple.buntic.dev",
    title: "Buntic Simple",
    description: "Sitio web de ejemplo simple con Buntic"
  }
});
