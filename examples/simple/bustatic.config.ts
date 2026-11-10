import { defineConfig } from "../../src/index.ts";

export default defineConfig({
  port: 3000,
  minify: true,
  site: {
    url: "https://simple.bustatic.dev",
    title: "Bustatic Simple",
    description: "Sitio web de ejemplo simple con Bustatic"
  }
});
