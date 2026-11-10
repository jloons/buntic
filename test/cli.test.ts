import { describe, test, expect } from "bun:test";
import { join } from "node:path";

describe("CLI", () => {
  const cliPath = join(import.meta.dir, "../bin/bustatic.ts");

  test("prints version with --version", async () => {
    const pkg = await Bun.file(join(import.meta.dir, "../package.json")).json();
    const proc = Bun.spawn(["bun", cliPath, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(output).toContain(`bustatic v${pkg.version}`);
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
    expect(proc.exitCode).toBe(0);
  });
});
