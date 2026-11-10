import { describe, test, expect } from "bun:test";
import { resolveConfig } from "../src/config.ts";
import { startDevServer } from "../src/server/dev.ts";
import { join } from "node:path";

describe("DevServer", () => {
  test("serves pages with live-reload and static assets from src layout", async () => {
    const exampleDir = join(import.meta.dir, "../examples/simple");
    const config = await resolveConfig(exampleDir, { port: 38899 });
    const dev = startDevServer(config);

    try {
      // 1. Root page
      const res = await fetch(`http://localhost:${dev.port}/`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Inicio | Bustatic Simple");
      expect(html).toContain("__bustatic_live_reload");

      // 2. Subpages
      const resAbout = await fetch(`http://localhost:${dev.port}/about`);
      expect(resAbout.status).toBe(200);
      const aboutHtml = await resAbout.text();
      expect(aboutHtml).toContain("Acerca de este proyecto");

      const resContact = await fetch(`http://localhost:${dev.port}/contact`);
      expect(resContact.status).toBe(200);
      const contactHtml = await resContact.text();
      expect(contactHtml).toContain("Contacto");

      // 3. Static CSS asset from src/styles/
      const resCss = await fetch(`http://localhost:${dev.port}/styles/main.css`);
      expect(resCss.status).toBe(200);
      const cssText = await resCss.text();
      expect(cssText).toContain("--bg-color");

      // 4. Public asset from src/public/
      const resRobots = await fetch(`http://localhost:${dev.port}/robots.txt`);
      expect(resRobots.status).toBe(200);
      const robotsText = await resRobots.text();
      expect(robotsText).toContain("User-agent: *");

      // 5. TypeScript file transpilation on the fly
      const resTs = await fetch(`http://localhost:${dev.port}/bustatic.config.ts`);
      expect(resTs.status).toBe(200);
      expect(resTs.headers.get("content-type")).toContain("application/javascript");
      const tsCode = await resTs.text();
      expect(tsCode).toContain("defineConfig");
    } finally {
      dev.stop();
    }
  });

  test("serves and transpiles web component TypeScript files on the fly", async () => {
    const fixtureDir = join(import.meta.dir, "fixtures/web-components");
    const config = await resolveConfig(fixtureDir, { port: 38898 });
    const dev = startDevServer(config);

    try {
      const resTs = await fetch(`http://localhost:${dev.port}/components/counter-button.ts`);
      expect(resTs.status).toBe(200);
      expect(resTs.headers.get("content-type")).toContain("application/javascript");
      const tsCode = await resTs.text();
      expect(tsCode).toContain("customElements.define");
      expect(tsCode).not.toContain("private count: number");
      expect(tsCode).toContain("count = 0");
    } finally {
      dev.stop();
    }
  });
});
