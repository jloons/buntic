#!/usr/bin/env bun
import { runCLI } from "../src/cli.ts";

await runCLI(process.argv.slice(2));
