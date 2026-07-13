import { test } from "node:test";
import assert from "node:assert/strict";
import { decideValidationVerdict, summarizeValidation } from "../core/report.mjs";

// ---- decideValidationVerdict ----

test("decideValidationVerdict: PASS when layer active, exercised, no timeout, no diagnostics", () => {
  const report = {
    tool: "t", lane: "l", repo: "r", base: null, sha: null,
    evidence: { layerActive: true, testsExercised: true, timedOut: false, exitCode: 0 },
    diagnostics: [],
  };
  const decision = decideValidationVerdict(report);
  assert.deepEqual(decision, { verdict: "PASS", code: 0 });
});

test("decideValidationVerdict: FAIL (code 2) when diagnostics present", () => {
  const report = {
    tool: "t", lane: "l", repo: "r", base: null, sha: null,
    evidence: { layerActive: true, testsExercised: true, timedOut: false, exitCode: 1 },
    diagnostics: [{ severity: "high", source: "s", message: "m" }],
  };
  const decision = decideValidationVerdict(report);
  assert.deepEqual(decision, { verdict: "FAIL", code: 2 });
});

test("decideValidationVerdict: QUARANTINED (code 5) when layerActive===false", () => {
  const report = {
    tool: "t", lane: "l", repo: "r", base: null, sha: null,
    evidence: { layerActive: false, testsExercised: true, timedOut: false },
    diagnostics: [],
  };
  const decision = decideValidationVerdict(report);
  assert.deepEqual(decision, { verdict: "QUARANTINED", code: 5 });
});

test("decideValidationVerdict: NO_EXERCISE (code 3) when testsExercised===false and allowEmpty false", () => {
  const report = {
    tool: "t", lane: "l", repo: "r", base: null, sha: null,
    evidence: { layerActive: true, testsExercised: false, timedOut: false },
    diagnostics: [],
  };
  const decision = decideValidationVerdict(report);
  assert.deepEqual(decision, { verdict: "NO_EXERCISE", code: 3 });
});

test("decideValidationVerdict: PASS_EMPTY (code 0) when testsExercised===false and allowEmpty true", () => {
  const report = {
    tool: "t", lane: "l", repo: "r", base: null, sha: null,
    evidence: { layerActive: true, testsExercised: false, timedOut: false },
    diagnostics: [],
  };
  const decision = decideValidationVerdict(report, { allowEmpty: true });
  assert.deepEqual(decision, { verdict: "PASS_EMPTY", code: 0 });
});

test("decideValidationVerdict: ERROR (code 6) on timedOut", () => {
  const report = {
    tool: "t", lane: "l", repo: "r", base: null, sha: null,
    evidence: { layerActive: true, testsExercised: true, timedOut: true },
    diagnostics: [],
  };
  const decision = decideValidationVerdict(report);
  assert.deepEqual(decision, { verdict: "ERROR", code: 6 });
});

// ---- summarizeValidation ----

test("summarizeValidation: returns a string containing tool, lane, repo, evidence fields and verdict", () => {
  const report = {
    tool: "kanarienkrebs", lane: "pr", repo: "/repo", base: "main", sha: "cafebabe12",
    evidence: { layerActive: true, testsExercised: true, timedOut: false, exitCode: 1 },
    diagnostics: [{ severity: "high", source: "runtime", message: "diagnostic occurred" }],
  };
  const decision = decideValidationVerdict(report);
  const text = summarizeValidation(report, decision);
  assert.match(text, /kanarienkrebs/);
  assert.match(text, /lane=pr/);
  assert.match(text, /repo=\/repo/);
  assert.match(text, /base=main/);
  assert.match(text, /sha=cafebabe/);
  assert.match(text, /layerActive=true/);
  assert.match(text, /testsExercised=true/);
  assert.match(text, /exit=1/);
  assert.match(text, /diagnostic occurred/);
  assert.match(text, /VERDICT FAIL \(exit 2\)/);
});

test("summarizeValidation: notes absence of diagnostics when there are none", () => {
  const report = {
    tool: "kanarienkrebs", lane: "pr", repo: "/repo", base: null, sha: null,
    evidence: { layerActive: true, testsExercised: true, timedOut: false, exitCode: 0 },
    diagnostics: [],
  };
  const decision = decideValidationVerdict(report);
  const text = summarizeValidation(report, decision);
  assert.match(text, /no validation diagnostics/);
  assert.match(text, /VERDICT PASS \(exit 0\)/);
});
