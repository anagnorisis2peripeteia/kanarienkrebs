import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { runUnderLayer, validateLayer } from "../kanarienkrebs/ts-runtime-lane.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const CANARY = join(REPO_ROOT, "fixtures", "canary-runtime", "deprecation-canary.mjs");

test("validateLayer returns true for the deprecation canary (strict layer flips clean->throw)", () => {
  const live = validateLayer(CANARY);
  assert.equal(live, true);
});

test("runUnderLayer on a trivial passing command returns exitCode 0 with no diagnostics", () => {
  const result = runUnderLayer({
    repo: REPO_ROOT,
    command: 'node -e "process.exit(0)"',
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.timedOut, false);
});

test("runUnderLayer honors a custom timeoutMs (large monorepo suites need a raised budget)", () => {
  const result = runUnderLayer({
    repo: REPO_ROOT,
    command: 'node -e "setTimeout(() => {}, 5000)"',
    timeoutMs: 300,
  });
  assert.equal(result.timedOut, true);
});

test("validateLayer is robust to strict NODE_OPTIONS already in the environment (regression)", () => {
  // Before the fix, the "plain" baseline spawn inherited NODE_OPTIONS, so with strict
  // flags already set the canary's deprecation threw there too, plain.status !== 0, and
  // validateLayer wrongly returned false (spurious quarantine) — exactly what kanarienkrebs
  // gating ITSELF, or any CI with NODE_OPTIONS set, would hit. It must still report live.
  const saved = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = "--throw-deprecation";
  try {
    assert.equal(validateLayer(CANARY), true);
  } finally {
    if (saved === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = saved;
  }
});
