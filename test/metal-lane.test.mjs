import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { validateMetalLayer, runMetal, metalAvailable, hasMetal } from "../kanarienkrebs/metal-validation-lane.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANARY_DIR = join(HERE, "..", "fixtures", "canary-metal");
const skip = metalAvailable() ? false : "Metal toolchain (xcrun metal) unavailable";

test("hasMetal detects a .metal marker vs a non-Metal dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "kan-metal-"));
  try {
    assert.equal(hasMetal(dir), false);
    writeFileSync(join(dir, "shader.metal"), "kernel void k() {}\n");
    assert.equal(hasMetal(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hasMetal finds the canary's kernel.metal fixture", () => {
  assert.equal(hasMetal(CANARY_DIR), true);
});

test("validateMetalLayer is true for the OOB canary (validation surfaces a fault the plain run does not)", { skip }, () => {
  assert.equal(validateMetalLayer(CANARY_DIR), true);
});

test("validateMetalLayer is robust to ambient MTL_SHADER_VALIDATION (regression: plain baseline scrubs the strict env)", { skip }, () => {
  const saved = process.env.MTL_SHADER_VALIDATION;
  process.env.MTL_SHADER_VALIDATION = "1";
  try {
    assert.equal(validateMetalLayer(CANARY_DIR), true);
  } finally {
    if (saved === undefined) delete process.env.MTL_SHADER_VALIDATION;
    else process.env.MTL_SHADER_VALIDATION = saved;
  }
});

test("runMetal surfaces the OOB device-store diagnostic on the canary under the validation layer", { skip }, () => {
  const work = mkdtempSync(join(tmpdir(), "kan-metal-run-"));
  try {
    const out = join(work, "harness");
    const harness = join(CANARY_DIR, "harness.mm");
    const kernel = join(CANARY_DIR, "kernel.metal");
    const cmd = `xcrun clang++ -std=c++17 -fobjc-arc -framework Metal -framework Foundation "${harness}" -o "${out}" && "${out}" "${kernel}"`;
    const r = runMetal({ repo: CANARY_DIR, testCommand: cmd });
    // Metal shader validation reports the OOB to stderr but does NOT abort — the run
    // still exits 0, so the signal is the parsed diagnostic, not the exit code.
    assert.ok(
      r.diagnostics.some((d) => d.source === "metal-validation" && /Invalid device/i.test(d.message)),
      "expected a metal-validation diagnostic",
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
