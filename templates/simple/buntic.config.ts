import { defineConfig } from "buntic";

export default defineConfig({
  port: 3000,
  minify: true,
  site: {
    url: "https://misitio.com",
    title: "Mi Proyecto",
    description: "Sitio web generado con Buntic"
  }
});
