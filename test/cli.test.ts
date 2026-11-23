import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("CLI", () => {
  const cliPath = join(import.meta.dir, "../bin/buntic.ts");
  const tempDirs: string[] = [];

  function makeTempDir(prefix = "buntic-cli-test-"): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prints version with --version", async () => {
    const pkg = await Bun.file(join(import.meta.dir, "../package.json")).json();
    const proc = Bun.spawn(["bun", cliPath, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(output).toContain(`buntic v${pkg.version}`);
    expect(proc.exitCode).toBe(0);
  });

  test("prints help with help", async () => {
    const proc = Bun.spawn(["bun", cliPath, "help"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(output).toContain("Lightweight zero-dependency static site generator for Bun");
    expect(output).toContain("USAGE:");
    expect(output).toContain("init [dir]");
    expect(proc.exitCode).toBe(0);
  });

  test("init creates default blank project without package.json, copies skills, and builds standalone", async () => {
    const parent = makeTempDir();
    const projectDir = join(parent, "my-blank-site");

    const initProc = Bun.spawn(["bun", cliPath, "init", projectDir], {
      cwd: parent,
      stdout: "pipe",
      stderr: "pipe",
    });
    const initOut = await new Response(initProc.stdout).text();
    const initErr = await new Response(initProc.stderr).text();
    await initProc.exited;

    expect(initErr).toBe("");
    expect(initProc.exitCode).toBe(0);
    expect(initOut).toContain("blank");

    // Zero package.json / node_modules
    expect(existsSync(join(projectDir, "package.json"))).toBe(false);
    expect(existsSync(join(projectDir, "node_modules"))).toBe(false);

    // Core project files, tsconfig, gitignore, ambient types, and skills
    expect(existsSync(join(projectDir, "buntic.config.ts"))).toBe(true);
    expect(existsSync(join(projectDir, "tsconfig.json"))).toBe(true);
    expect(existsSync(join(projectDir, ".gitignore"))).toBe(true);
    expect(existsSync(join(projectDir, "_gitignore"))).toBe(false);
    expect(existsSync(join(projectDir, "src/pages/index.html"))).toBe(true);
    expect(existsSync(join(projectDir, "src/layouts/main.html"))).toBe(true);
    expect(existsSync(join(projectDir, "src/styles/main.css"))).toBe(true);
    expect(existsSync(join(projectDir, ".buntic/types/index.d.ts"))).toBe(true);
    expect(existsSync(join(projectDir, ".agents/skills/buntic/SKILL.md"))).toBe(true);

    // Build project from inside its directory with NO package.json or node_modules
    const buildProc = Bun.spawn(["bun", cliPath, "build"], {
      cwd: projectDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const buildOut = await new Response(buildProc.stdout).text();
    const buildErr = await new Response(buildProc.stderr).text();
    await buildProc.exited;

    expect(buildErr).toBe("");
    expect(buildProc.exitCode).toBe(0);
    expect(buildOut).toContain("Successfully built 1 page(s)");
    expect(existsSync(join(projectDir, "dist/index.html"))).toBe(true);
    expect(existsSync(join(projectDir, "dist/sitemap.xml"))).toBe(true);
    expect(existsSync(join(projectDir, "dist/robots.txt"))).toBe(true);
  });

  test("init --template simple --no-skills creates multipage project without skills or package.json", async () => {
    const parent = makeTempDir();
    const projectDir = join(parent, "my-simple-site");

    const initProc = Bun.spawn(
      ["bun", cliPath, "init", projectDir, "--template", "simple", "--no-skills"],
      {
        cwd: parent,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    await initProc.exited;

    expect(initProc.exitCode).toBe(0);
    expect(existsSync(join(projectDir, "package.json"))).toBe(false);
    expect(existsSync(join(projectDir, ".agents/skills/buntic/SKILL.md"))).toBe(false);
    expect(existsSync(join(projectDir, "tsconfig.json"))).toBe(true);
    expect(existsSync(join(projectDir, ".gitignore"))).toBe(true);
    expect(existsSync(join(projectDir, "src/pages/about.html"))).toBe(true);
    expect(existsSync(join(projectDir, "src/components/card.html"))).toBe(true);

    const buildProc = Bun.spawn(["bun", cliPath, "build", projectDir], {
      cwd: parent,
      stdout: "pipe",
      stderr: "pipe",
    });
    const buildOut = await new Response(buildProc.stdout).text();
    await buildProc.exited;

    expect(buildProc.exitCode).toBe(0);
    expect(buildOut).toContain("Successfully built 3 page(s)");
    expect(existsSync(join(projectDir, "dist/index.html"))).toBe(true);
    expect(existsSync(join(projectDir, "dist/about.html"))).toBe(true);
    expect(existsSync(join(projectDir, "dist/contact.html"))).toBe(true);
  });

  test("init refuses non-empty directory unless --force is passed", async () => {
    const targetDir = makeTempDir();
    writeFileSync(join(targetDir, "existing.txt"), "hello", "utf8");

    const failProc = Bun.spawn(["bun", cliPath, "init", targetDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const failErr = await new Response(failProc.stderr).text();
    await failProc.exited;

    expect(failProc.exitCode).toBe(1);
    expect(failErr).toContain("is not empty");

    const forceProc = Bun.spawn(["bun", cliPath, "init", targetDir, "--force"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await forceProc.exited;

    expect(forceProc.exitCode).toBe(0);
    expect(existsSync(join(targetDir, "buntic.config.ts"))).toBe(true);
  });

  test("rejects invalid --port and unknown --template", async () => {
    const badPort = Bun.spawn(["bun", cliPath, "dev", "--port", "abc"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const badPortErr = await new Response(badPort.stderr).text();
    await badPort.exited;
    expect(badPort.exitCode).toBe(1);
    expect(badPortErr).toContain("Invalid port");

    const badTpl = Bun.spawn(["bun", cliPath, "init", makeTempDir(), "--template", "nonexistent"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const badTplErr = await new Response(badTpl.stderr).text();
    await badTpl.exited;
    expect(badTpl.exitCode).toBe(1);
    expect(badTplErr).toContain("Unknown template");
  });
});
