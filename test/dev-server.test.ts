import { describe, test, expect } from "bun:test";
import { resolveConfig } from "../src/config.ts";
import { startDevServer } from "../src/server/dev.ts";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync, renameSync, unlinkSync, existsSync } from "node:fs";

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

  test("invalidates sibling CSS cache and reloads properly on Vim-style save (with 4913, backup~ and .swp files)", async () => {
    const tmpDir = join(import.meta.dir, ".tmp-test-dev-vim-reload");
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    mkdirSync(join(tmpDir, "src/pages"), { recursive: true });
    mkdirSync(join(tmpDir, "src/components"), { recursive: true });

    await Bun.write(
      join(tmpDir, "src/pages/index.html"),
      `<!doctype html><html><head><title>Test</title></head><body><component src="../components/box.html" /></body></html>`
    );
    await Bun.write(join(tmpDir, "src/components/box.html"), `<div class="box">Hello</div>`);
    const boxCssPath = join(tmpDir, "src/components/box.css");
    await Bun.write(boxCssPath, `& { background-color: #112233; }`);

    const config = await resolveConfig(tmpDir, { port: 38897 });
    const dev = startDevServer(config);

    try {
      // 1. Initial load populates VFS contentCache
      const res1 = await fetch(`http://localhost:${dev.port}/`);
      const html1 = await res1.text();
      expect(html1).toContain("#112233");

      // 2. Simulate Vim saving box.css:
      //    - creates/deletes 4913 probe file
      //    - renames box.css -> box.css~
      //    - writes new box.css
      //    - deletes box.css~ and updates .box.css.swp last
      const compDir = join(tmpDir, "src/components");
      writeFileSync(join(compDir, "4913"), "");
      unlinkSync(join(compDir, "4913"));
      renameSync(boxCssPath, `${boxCssPath}~`);
      writeFileSync(boxCssPath, `& { background-color: #abcdef; }`);
      unlinkSync(`${boxCssPath}~`);
      writeFileSync(join(compDir, ".box.css.swp"), "swapcontent");

      // Wait for debounce (60ms) to settle
      await Bun.sleep(150);

      // 3. Subsequent page request must reflect the updated sibling CSS
      const res2 = await fetch(`http://localhost:${dev.port}/`);
      const html2 = await res2.text();
      expect(html2).toContain("#abcdef");
      expect(html2).not.toContain("#112233");
    } finally {
      dev.stop();
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });
});
