#!/usr/bin/env node
// validate-provider.mjs
//
// Gate analog of marmorkrebs's "validate_providers" step for kanarienkrebs: proves
// each runtime-validation LANE is actually live — i.e. --validate mode catches its
// own planted canary — before the lane is trusted as a PR gate. Fail-closed: an
// un-provable lane blocks the gate. A lane whose toolchain is absent on this box is
// SKIPPED (not failed), so a Node-only CI stays green while local runs prove both.
//
//   ts-runtime    : node kanarienkrebs/cli.mjs --validate
//   go-race       : node kanarienkrebs/cli.mjs --validate --lane go       (requires `go`)
//   python-dev    : node kanarienkrebs/cli.mjs --validate --lane python   (requires `python3`)
//   dotnet-runtime: node kanarienkrebs/cli.mjs --validate --lane dotnet   (requires `dotnet`)
//   csharp-roslyn : node kanarienkrebs/cli.mjs --validate --lane csharp-roslyn
//   cpp-sanitizer : node kanarienkrebs/cli.mjs --validate --lane cpp      (requires `clang++`)
//   metal-validation: node kanarienkrebs/cli.mjs --validate --lane metal  (requires `xcrun`/Metal)

import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const CLI = path.join(repoRoot, "kanarienkrebs", "cli.mjs");

// EX_UNAVAILABLE — the CLI's exit code when a lane's toolchain is absent. Treat it as
// SKIP (not FAIL), so a box missing e.g. the Metal toolchain stays green.
const EX_UNAVAILABLE = 69;

const LANES = [
  { name: "ts-runtime", args: ["--validate"] },
  { name: "go-race", args: ["--validate", "--lane", "go"], requires: "go" },
  { name: "python-dev", args: ["--validate", "--lane", "python"], requires: "python3" },
  { name: "dotnet-runtime", args: ["--validate", "--lane", "dotnet"], requires: "dotnet" },
  { name: "csharp-roslyn", args: ["--validate", "--lane", "csharp-roslyn"] },
  { name: "cpp-sanitizer", args: ["--validate", "--lane", "cpp"], requires: "clang++" },
  // metal needs the Metal toolchain + a GPU; `xcrun` gates macOS, and the CLI itself
  // reports EX_UNAVAILABLE (=> SKIP below) if `xcrun -f metal` can't resolve the compiler.
  { name: "metal-validation", args: ["--validate", "--lane", "metal"], requires: "xcrun" },
];

function toolAvailable(tool) {
  // `python3 --version` and `node --version` use --version; `go version` uses a subcommand.
  for (const va of [["--version"], ["version"]]) {
    const r = spawnSync(tool, va, { encoding: "utf8" });
    if (!r.error && r.status === 0) return true;
  }
  return false;
}

function runValidate(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", (err) => resolve({ exitCode: null, stdout, stderr: `${stderr}\n${err.message}` }));
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

async function main() {
  console.log("validate-provider: kanarienkrebs canary gates");
  console.log("=".repeat(48));
  let allOk = true;
  for (const lane of LANES) {
    if (lane.requires && !toolAvailable(lane.requires)) {
      console.log(`- ${lane.name}: SKIP (${lane.requires} not on PATH)`);
      continue;
    }
    const result = await runValidate(lane.args);
    if (result.exitCode === EX_UNAVAILABLE) {
      console.log(`- ${lane.name}: SKIP (toolchain unavailable on this box)`);
      continue;
    }
    const ok = result.exitCode === 0;
    if (!ok) allOk = false;
    console.log(`- ${lane.name}: ${ok ? "OK" : "FAIL"} (exit=${result.exitCode})`);
    for (const line of (result.stdout.trim() ? result.stdout.trim().split("\n") : [])) console.log(`    ${line}`);
    if (!ok) for (const line of (result.stderr.trim() ? result.stderr.trim().split("\n") : [])) console.error(`    ! ${line}`);
  }
  console.log("=".repeat(48));
  console.log(allOk ? "validate-provider: PASS (lanes live)" : "validate-provider: FAIL");
  process.exitCode = allOk ? 0 : 1;
}

main();
