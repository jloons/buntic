import { resolveConfig } from "./config.ts";
import { Builder } from "./builder/builder.ts";
import { startDevServer } from "./server/dev.ts";

export async function runCLI(args: string[]): Promise<void> {
  const command = args[0] || "help";

  if (command === "--version" || command === "-v") {
    const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
    console.log(`bustatic v${pkg.version}`);
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

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" || arg === "-p") {
      port = parseInt(args[++i], 10);
    } else if (arg === "--outdir" || arg === "-o") {
      outDir = args[++i];
    } else if (!arg.startsWith("-")) {
      targetDir = arg;
    }
  }

  if (command === "dev") {
    const config = await resolveConfig(targetDir, { port });
    console.log(`\n🚀 \x1b[36m[Bustatic]\x1b[0m Starting dev server for: \x1b[33m${config.root}\x1b[0m`);
    const devInstance = startDevServer(config);
    console.log(`   ➜ Local:   \x1b[32mhttp://localhost:${devInstance.port}/\x1b[0m`);
    console.log(`   ➜ Live reload enabled via WebSockets.\n`);

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      console.log("\n\x1b[33m[Bustatic]\x1b[0m Shutting down server...");
      devInstance.stop();
      process.exit(0);
    });
  } else if (command === "build") {
    const config = await resolveConfig(targetDir, { outDir });
    console.log(`\n📦 \x1b[36m[Bustatic]\x1b[0m Building static site for: \x1b[33m${config.root}\x1b[0m`);

    const builder = new Builder(config);
    try {
      const result = await builder.build();
      console.log(`\x1b[32m✔\x1b[0m Successfully built ${result.pagesCount} page(s) in ${result.durationMs}ms`);
      console.log(`\x1b[32m✔\x1b[0m Output directory: \x1b[33m${config.outDir}\x1b[0m\n`);
    } catch (err: any) {
      console.error(`\x1b[31m✖ [Bustatic Build Error]:\x1b[0m`, err?.message || err);
      process.exit(1);
    }
  } else {
    console.error(`\x1b[31mUnknown command:\x1b[0m "${command}"`);
    printHelp();
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
\x1b[1mBustatic\x1b[0m - Lightweight zero-dependency static site generator for Bun

\x1b[1mUSAGE:\x1b[0m
  bustatic <command> [directory] [options]

\x1b[1mCOMMANDS:\x1b[0m
  dev [dir]       Start the development server with live reload
  build [dir]     Build the static site for production into dist/
  help            Show this help message

\x1b[1mOPTIONS:\x1b[0m
  -p, --port <port>       Port to run dev server on (default: 3000)
  -o, --outdir <dir>      Output directory for build (default: dist)
  -v, --version           Show version number
  -h, --help              Show help

\x1b[1mEXAMPLES:\x1b[0m
  $ bustatic dev
  $ bustatic dev my-site --port 8080
  $ bustatic build
  $ bustatic build my-site --outdir ./public_html
`);
}
