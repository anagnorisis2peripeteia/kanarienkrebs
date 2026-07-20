// kanarienkrebs — C# Roslyn runtime-validation lane (phase-1 scaffold).
//
// This is intentionally not a full implementation yet. It wires the lane boundary
// (probe/validation contract + fail-closed default diagnostics) so the project can
// evolve with a tracked implementation PR for Roslyn instrumentation + runtime probe.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const CANARY_DIR = join(HERE, "..", "fixtures", "canary-csharp-roslyn");
const CANARY_PATH = join(CANARY_DIR, "canary.cs");

export function runCSharpRoslyn({ repo, testCommand, timeoutMs = 300000 }) {
  const commandText = testCommand ?? "dotnet test";
  const details = [
    `repo=${repo ?? "<missing>"}`,
    `testCommand=${commandText}`,
    `timeoutMs=${timeoutMs}`,
  ].join(" ");
  return {
    exitCode: 1,
    signal: null,
    timedOut: false,
    diagnostics: [
      {
        severity: "error",
        source: "csharp-roslyn",
        message: `csharp-roslyn lane is a phase-1 scaffold: real Roslyn instrumentation and runtime validation is not implemented yet (${details})`,
      },
    ],
    raw: `kanarienkrebs --lane csharp-roslyn [scaffold] · ${details}`,
  };
}

// Validation-provider contract: a live layer must catch a canary, but for this first
// scaffold PR we only check that the canary marker exists and is wired into CI.
export function validateCSharpRoslynLayer(canaryDir = CANARY_DIR) {
  return existsSync(canaryDir) && existsSync(join(canaryDir, "canary.cs"));
}

