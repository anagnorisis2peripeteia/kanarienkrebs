#!/usr/bin/env node
// validate-provider.mjs
//
// Gate analog of marmorkrebs's "validate_providers" step for the kanarienkrebs
// repo: proves that the runtime-validation canary lane is actually live — i.e.
// --validate mode catches its own planted canary — before the lane is trusted
// as a PR gate.
//
// Runs: node kanarienkrebs/cli.mjs --validate
//
// Asserts exit 0. Prints a summary. Exits nonzero on failure (fail-closed: an
// un-provable provider must block the gate, not pass it).

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const provider = { name: "kanarienkrebs", script: path.join(repoRoot, "kanarienkrebs", "cli.mjs") };

function runValidate({ name, script }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, "--validate"], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      resolve({ name, exitCode: null, stdout, stderr: `${stderr}\n${err.message}`, error: err });
    });

    child.on("close", (exitCode) => {
      resolve({ name, exitCode, stdout, stderr });
    });
  });
}

async function main() {
  const result = await runValidate(provider);

  console.log("validate-provider: kanarienkrebs canary gate");
  console.log("=".repeat(48));

  const ok = result.exitCode === 0;
  const status = ok ? "OK" : "FAIL";
  console.log(`- ${result.name}: ${status} (exit=${result.exitCode})`);
  if (result.stdout.trim()) {
    for (const line of result.stdout.trim().split("\n")) {
      console.log(`    ${line}`);
    }
  }
  if (!ok && result.stderr.trim()) {
    for (const line of result.stderr.trim().split("\n")) {
      console.error(`    ! ${line}`);
    }
  }

  console.log("=".repeat(48));
  console.log(ok ? "validate-provider: PASS (canary live)" : "validate-provider: FAIL");

  process.exitCode = ok ? 0 : 1;
}

main();
