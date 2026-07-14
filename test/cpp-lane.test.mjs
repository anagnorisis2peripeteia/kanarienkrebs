import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { validateCppLayer, runCpp, cppAvailable, hasCpp } from "../kanarienkrebs/cpp-sanitizer-lane.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANARY_DIR = join(HERE, "..", "fixtures", "canary-cpp");
const skip = cppAvailable() ? false : "clang++ not on PATH";

test("hasCpp detects a C++ source/build marker vs a non-C++ dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "kan-cpp-"));
  try {
    assert.equal(hasCpp(dir), false);
    writeFileSync(join(dir, "main.cpp"), "int main(){return 0;}\n");
    assert.equal(hasCpp(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hasCpp finds the canary's overflow.cpp fixture", () => {
  assert.equal(hasCpp(CANARY_DIR), true);
});

test("validateCppLayer is true for the overflow canary (sanitizers flip 0 -> abort)", { skip }, () => {
  assert.equal(validateCppLayer(CANARY_DIR), true);
});

test("validateCppLayer is robust to ambient ASAN_OPTIONS (regression: plain baseline scrubs the strict env)", { skip }, () => {
  const saved = process.env.ASAN_OPTIONS;
  // An ambient value that would swallow the abort must not defeat the check.
  process.env.ASAN_OPTIONS = "exitcode=0:abort_on_error=0";
  try {
    assert.equal(validateCppLayer(CANARY_DIR), true);
  } finally {
    if (saved === undefined) delete process.env.ASAN_OPTIONS;
    else process.env.ASAN_OPTIONS = saved;
  }
});

test("runCpp surfaces a sanitizer diagnostic on the canary under the sanitizer layer", { skip }, () => {
  const work = mkdtempSync(join(tmpdir(), "kan-cpp-run-"));
  try {
    const out = join(work, "a.out");
    const src = join(CANARY_DIR, "overflow.cpp");
    // The sanitizer flags arrive via the injected $CXXFLAGS (runCpp's strict layer).
    const cmd = `clang++ -std=c++17 $CXXFLAGS "${src}" -o "${out}" && "${out}"`;
    const r = runCpp({ repo: CANARY_DIR, testCommand: cmd });
    assert.notEqual(r.exitCode, 0);
    assert.ok(
      r.diagnostics.some((d) => d.source === "cpp-sanitizer" && /Sanitizer|runtime error/i.test(d.message)),
      "expected a cpp-sanitizer diagnostic",
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
