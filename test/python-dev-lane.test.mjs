import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { validatePythonLayer, runUnderDevMode, pythonAvailable, hasPython } from "../kanarienkrebs/python-dev-lane.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANARY = join(HERE, "..", "fixtures", "canary-python", "deprecation_canary.py");
const skip = pythonAvailable() ? false : "python3 not on PATH";

test("hasPython detects a python project marker", () => {
  const dir = mkdtempSync(join(tmpdir(), "kan-py-"));
  try {
    assert.equal(hasPython(dir), false);
    writeFileSync(join(dir, "pyproject.toml"), "[project]\nname = 'x'\n");
    assert.equal(hasPython(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validatePythonLayer is true for the deprecation canary (dev layer flips pass -> raise)", { skip }, () => {
  assert.equal(validatePythonLayer(CANARY), true);
});

test("validatePythonLayer is robust to ambient PYTHONWARNINGS (regression: plain baseline scrubs the strict env)", { skip }, () => {
  const saved = process.env.PYTHONWARNINGS;
  process.env.PYTHONWARNINGS = "error::DeprecationWarning";
  try {
    assert.equal(validatePythonLayer(CANARY), true);
  } finally {
    if (saved === undefined) delete process.env.PYTHONWARNINGS;
    else process.env.PYTHONWARNINGS = saved;
  }
});

test("runUnderDevMode surfaces a DeprecationWarning as a failure", { skip }, () => {
  const r = runUnderDevMode({ repo: join(HERE, ".."), testCommand: `python3 ${CANARY}` });
  assert.notEqual(r.exitCode, 0);
  assert.ok(r.diagnostics.length > 0, "expected a diagnostic");
});
