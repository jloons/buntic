import { defineConfig } from "bustatic";

export default defineConfig({
  port: 3000,
  minify: true,
  site: {
    url: "https://misitio.com",
    title: "Mi Proyecto",
    description: "Sitio web generado con Bustatic"
  }
});
