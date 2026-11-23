import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");
const distDir = join(rootDir, "dist");

if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}

console.log("[build:pkg] Bundling library (dist/index.js)...");
const libBuild = await Bun.build({
  entrypoints: [join(rootDir, "src", "index.ts")],
  outdir: distDir,
  target: "bun",
  format: "esm",
  splitting: false,
  sourcemap: "none",
  minify: false,
});

if (!libBuild.success) {
  for (const log of libBuild.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log("[build:pkg] Bundling CLI (dist/cli.js)...");
const cliBuild = await Bun.build({
  entrypoints: [join(rootDir, "bin", "buntic.ts")],
  outdir: distDir,
  naming: "cli.js",
  target: "bun",
  format: "esm",
  splitting: false,
  sourcemap: "none",
  minify: false,
});

if (!cliBuild.success) {
  for (const log of cliBuild.logs) {
    console.error(log);
  }
  process.exit(1);
}

const cliOutPath = join(distDir, "cli.js");
const cliContent = await Bun.file(cliOutPath).text();
if (!cliContent.startsWith("#!/usr/bin/env bun")) {
  await Bun.write(cliOutPath, `#!/usr/bin/env bun\n${cliContent}`);
}
chmodSync(cliOutPath, 0o755);

console.log("[build:pkg] Emitting TypeScript declarations (dist/**/*.d.ts)...");
const tscProc = Bun.spawn(["bunx", "tsc", "-p", join(rootDir, "tsconfig.build.json")], {
  cwd: rootDir,
  stdout: "inherit",
  stderr: "inherit",
});
const tscExit = await tscProc.exited;
if (tscExit !== 0) {
  process.exit(tscExit);
}

// Normalize relative .ts specifiers to .js in emitted .d.ts files for universal TS compatibility
function rewriteDtsExtensions(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      rewriteDtsExtensions(fullPath);
    } else if (entry.isFile() && entry.name.endsWith(".d.ts")) {
      const content = readFileSync(fullPath, "utf8");
      const rewritten = content.replace(/(from\s+["']\.[^"']+)\.ts(["'])/g, "$1.js$2");
      if (rewritten !== content) {
        writeFileSync(fullPath, rewritten, "utf8");
      }
    }
  }
}
rewriteDtsExtensions(distDir);

console.log("[build:pkg] Done! Built dist/index.js, dist/cli.js and dist/**/*.d.ts");
