export type { BustaticConfig, ResolvedConfig, PageInfo } from "./types.ts";
export { defineConfig, resolveConfig } from "./config.ts";
export { TemplateEngine } from "./template/engine.ts";
export { Builder, type BuildResult } from "./builder/builder.ts";
export { startDevServer, type DevServerInstance } from "./server/dev.ts";
export { runCLI } from "./cli.ts";

/**
 * Programmatic helper to build a site.
 */
export async function build(dir = ".", overrides = {}) {
  const { resolveConfig } = await import("./config.ts");
  const { Builder } = await import("./builder/builder.ts");
  const config = await resolveConfig(dir, overrides);
  const builder = new Builder(config);
  return builder.build();
}

/**
 * Programmatic helper to start dev server.
 */
export async function dev(dir = ".", overrides = {}) {
  const { resolveConfig } = await import("./config.ts");
  const { startDevServer } = await import("./server/dev.ts");
  const config = await resolveConfig(dir, overrides);
  return startDevServer(config);
}
