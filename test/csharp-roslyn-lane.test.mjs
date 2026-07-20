import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { runCSharpRoslyn, validateCSharpRoslynLayer } from "../kanarienkrebs/csharp-roslyn-lane.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANARY_DIR = join(HERE, "..", "fixtures", "canary-csharp-roslyn");

test("validateCSharpRoslynLayer is true for its scaffold canary marker", () => {
  assert.equal(validateCSharpRoslynLayer(CANARY_DIR), true);
});

test("runCSharpRoslyn is a scaffold fail-closed stub", () => {
  const result = runCSharpRoslyn({ repo: "repo", testCommand: "dotnet test", timeoutMs: 120000 });
  assert.equal(result.exitCode, 1);
  assert.equal(result.timedOut, false);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].source, "csharp-roslyn");
  assert.match(result.diagnostics[0].message, /not implemented yet/);
});
