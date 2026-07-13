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
