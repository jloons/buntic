import { existsSync, rmSync } from "node:fs";
import { relative } from "node:path";
import { resolveConfig } from "./config.ts";
import { Builder } from "./builder/builder.ts";
import { startDevServer } from "./server/dev.ts";
import { AssetCache } from "./assets/cache.ts";
import { initProject, AVAILABLE_TEMPLATES } from "./init.ts";
import { getPackageRoot, registerBunticModuleResolver, syncProjectTypes } from "./runtime.ts";
import { getErrorMessage } from "./utils/logger.ts";

export async function runCLI(args: string[]): Promise<void> {
  registerBunticModuleResolver();

  const command = args[0] || "help";

  if (command === "--version" || command === "-v") {
    const pkg = await Bun.file(`${getPackageRoot()}/package.json`).json();
    console.log(`buntic v${pkg.version}`);
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  // Parse positional directory and optional flags
  let targetDir = ".";
  let port: number | undefined;
  let outDir: string | undefined;
  let cleanCache = false;
  let template: string | undefined;
  let includeSkills = true;
  let force = false;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" || arg === "-p") {
      const next = args[++i];
      const parsed = Number(next);
      if (!next || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        console.error(`\x1b[31mInvalid port value:\x1b[0m "${next ?? ""}". Expected an integer between 1 and 65535.`);
        process.exit(1);
      }
      port = parsed;
    } else if (arg === "--outdir" || arg === "-o") {
      const next = args[++i];
      if (!next || next.startsWith("-")) {
        console.error(`\x1b[31mMissing value for ${arg}.\x1b[0m`);
        process.exit(1);
      }
      outDir = next;
    } else if (arg === "--template" || arg === "-t") {
      const next = args[++i];
      if (!next || next.startsWith("-")) {
        console.error(`\x1b[31mMissing value for ${arg}.\x1b[0m Available templates: ${AVAILABLE_TEMPLATES.join(", ")}`);
        process.exit(1);
      }
      template = next;
    } else if (arg === "--no-skills") {
      includeSkills = false;
    } else if (arg === "--force" || arg === "-f") {
      force = true;
    } else if (arg === "--clean-cache" || arg === "--clean") {
      cleanCache = true;
    } else if (!arg.startsWith("-")) {
      targetDir = arg;
    }
  }

  try {
    if (command === "init") {
      const result = initProject({
        targetDir,
        template,
        includeSkills,
        force,
      });

      const relTarget = relative(process.cwd(), result.targetDir) || ".";
      console.log(
        `\n⚡ \x1b[36m[Buntic]\x1b[0m Initialized new project (\x1b[33m${result.template}\x1b[0m) in: \x1b[32m${result.targetDir}\x1b[0m`
      );
      console.log(`  ✔ Created ${result.filesCopied} file(s) (no package.json required)`);
      if (result.skillsDir) {
        console.log(`  ✔ Installed Buntic agent skill in .agents/skills/buntic`);
      }
      console.log(`  ✔ Generated TypeScript definitions in .buntic/types/`);
      console.log(`\n\x1b[1mNext steps:\x1b[0m`);
      if (relTarget !== ".") {
        console.log(`  cd ${relTarget}`);
      }
      console.log(`  buntic dev\n`);
      return;
    }

    if (command === "clean") {
      const config = await resolveConfig(targetDir);
      console.log(`\n🧹 \x1b[36m[Buntic]\x1b[0m Cleaning build and cache directories for: \x1b[33m${config.root}\x1b[0m`);
      if (existsSync(config.outDir)) {
        rmSync(config.outDir, { recursive: true, force: true });
        console.log(`  ✔ Removed ${config.outDir}`);
      }
      const cache = new AssetCache(config.cacheDir);
      await cache.clean();
      console.log(`  ✔ Cleaned ${config.cacheDir}`);
      console.log(`\x1b[32m✔\x1b[0m Project cleaned successfully.\n`);
      return;
    }

    if (command === "dev") {
      const config = await resolveConfig(targetDir, { port });
      syncProjectTypes(config.root);

      if (cleanCache) {
        const cache = new AssetCache(config.cacheDir);
        await cache.clean();
        console.log(`\x1b[32m✔\x1b[0m Cache cleaned.`);
      }

      console.log(`\n🚀 \x1b[36m[Buntic]\x1b[0m Starting dev server for: \x1b[33m${config.root}\x1b[0m`);
      const devInstance = startDevServer(config);
      console.log(`   ➜ Local:   \x1b[32mhttp://localhost:${devInstance.port}/\x1b[0m`);
      console.log(`   ➜ Live reload enabled via WebSockets.\n`);

      // Handle graceful shutdown
      process.on("SIGINT", () => {
        console.log("\n\x1b[33m[Buntic]\x1b[0m Shutting down server...");
        devInstance.stop();
        process.exit(0);
      });
    } else if (command === "build") {
      const config = await resolveConfig(targetDir, { outDir });
      syncProjectTypes(config.root);

      console.log(`\n📦 \x1b[36m[Buntic]\x1b[0m Building static site for: \x1b[33m${config.root}\x1b[0m`);

      const builder = new Builder(config);
      const result = await builder.build({ cleanCache });
      console.log(`\x1b[32m✔\x1b[0m Successfully built ${result.pagesCount} page(s) in ${result.durationMs}ms`);
      console.log(`\x1b[32m✔\x1b[0m Output directory: \x1b[33m${config.outDir}\x1b[0m\n`);
    } else {
      console.error(`\x1b[31mUnknown command:\x1b[0m "${command}"`);
      printHelp();
      process.exit(1);
    }
  } catch (err: unknown) {
    console.error(`\n\x1b[31m${getErrorMessage(err)}\x1b[0m\n`);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
\x1b[1mBuntic\x1b[0m - Lightweight zero-dependency static site generator for Bun

\x1b[1mUSAGE:\x1b[0m
  buntic <command> [directory] [options]

\x1b[1mCOMMANDS:\x1b[0m
  init [dir]      Initialize a new Buntic project (zero package.json)
  dev [dir]       Start the development server with live reload
  build [dir]     Build the static site for production into dist/
  clean [dir]     Remove dist/ and .buntic/cache/ directories
  help            Show this help message

\x1b[1mOPTIONS:\x1b[0m
  -t, --template <name>   Template for init: ${AVAILABLE_TEMPLATES.join(", ")} (default: blank)
  --no-skills             Skip installing agent skills in .agents/skills/buntic
  -f, --force             Allow init in a non-empty directory
  -p, --port <port>       Port to run dev server on (default: 3000)
  -o, --outdir <dir>      Output directory for build (default: dist)
  --clean-cache           Clean persistent asset cache before build/dev
  -v, --version           Show version number
  -h, --help              Show help

\x1b[1mEXAMPLES:\x1b[0m
  $ buntic init mi-sitio
  $ buntic init mi-sitio --template simple
  $ buntic dev
  $ buntic dev my-site --port 8080
  $ buntic build
  $ buntic build my-site --outdir ./public_html --clean-cache
  $ buntic clean
`);
}
