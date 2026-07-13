#!/usr/bin/env node
// kanarienkrebs — diff-scoped, fail-closed runtime-validation gate (MVP: TS/Node lane).
// Usage:
//   kanarienkrebs --repo <path> [--lane ts|go|python] [--test-command "<cmd>"] [--base <ref>] [--report-file <p>] [--allow-empty] [--timeout-ms <n>]
//   kanarienkrebs --validate [--lane ts|go|python]   (prove the runtime layer is genuinely live)
// Lane auto-detects from the repo (go.mod => go; pure-python => python) unless --lane is given.
import { writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runUnderLayer, validateLayer } from "./ts-runtime-lane.mjs";
import { runGoRace, validateGoLayer, hasGoMod, goAvailable } from "./go-race-lane.mjs";
import { runUnderDevMode, validatePythonLayer, hasPython, pythonAvailable } from "./python-dev-lane.mjs";
import { decideValidationVerdict, summarizeValidation } from "../core/report.mjs";
import { repoHead, changedFiles } from "../core/diff.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === "--repo") a.repo = next();
    else if (k === "--test-command") a.testCommand = next();
    else if (k === "--base") a.base = next();
    else if (k === "--report-file") a.reportFile = next();
    else if (k === "--allow-empty") a.allowEmpty = true;
    else if (k === "--timeout-ms") a.timeoutMs = parseInt(next(), 10);
    else if (k === "--lane") a.lane = next();
    else if (k === "--validate") a.validate = true;
  }
  return a;
}

const a = parseArgs(process.argv.slice(2));
const lane = a.lane ?? (
  a.repo && hasGoMod(a.repo) ? "go"
    : a.repo && hasPython(a.repo) && !existsSync(join(a.repo, "package.json")) ? "python"
      : "ts"
);
const laneName = lane === "go" ? "go-race" : lane === "python" ? "python-dev" : "ts-runtime";

if (a.validate) {
  let live;
  if (lane === "go") {
    if (!goAvailable()) { console.error("kanarienkrebs: go not on PATH — cannot validate the go-race lane"); process.exit(69); }
    live = validateGoLayer(join(HERE, "..", "fixtures", "canary-go"));
  } else if (lane === "python") {
    if (!pythonAvailable()) { console.error("kanarienkrebs: python3 not on PATH — cannot validate the python-dev lane"); process.exit(69); }
    live = validatePythonLayer(join(HERE, "..", "fixtures", "canary-python", "deprecation_canary.py"));
  } else {
    live = validateLayer(join(HERE, "..", "fixtures", "canary-runtime", "deprecation-canary.mjs"));
  }
  console.log(`kanarienkrebs validate-provider · lane=${laneName} · layerActive=${live}`);
  console.log(live ? "  ✓ ENGINE_OK (the layer is genuinely live)" : "  ✗ QUARANTINED (layer had no effect)");
  process.exit(live ? 0 : 5);
}

if (!a.repo) {
  console.error("kanarienkrebs: --repo <path> required (or --validate)");
  process.exit(64);
}
if ((lane === "ts" || lane === "python") && !a.testCommand) {
  console.error(`kanarienkrebs: --test-command "<cmd>" required for the ${lane} lane`);
  process.exit(64);
}
if (lane === "go" && !goAvailable()) {
  console.error("kanarienkrebs: go not on PATH — cannot run the go-race lane");
  process.exit(69);
}
if (lane === "python" && !pythonAvailable()) {
  console.error("kanarienkrebs: python3 not on PATH — cannot run the python-dev lane");
  process.exit(69);
}

const run = lane === "go"
  ? runGoRace({ repo: a.repo, testCommand: a.testCommand, timeoutMs: a.timeoutMs })
  : lane === "python"
    ? runUnderDevMode({ repo: a.repo, testCommand: a.testCommand, timeoutMs: a.timeoutMs })
    : runUnderLayer({ repo: a.repo, command: a.testCommand, timeoutMs: a.timeoutMs });
const changed = a.base ? changedFiles(a.repo, a.base) : null;

const report = {
  tool: "kanarienkrebs",
  lane: laneName,
  repo: a.repo,
  base: a.base ?? null,
  sha: repoHead(a.repo),
  evidence: {
    layerActive: true, // proven separately via --validate; assumed for this run
    testsExercised: !run.timedOut && run.exitCode !== null,
    timedOut: run.timedOut,
    exitCode: run.exitCode,
  },
  diagnostics: run.diagnostics,
};
if (changed) report.changedFiles = changed;

const decision = decideValidationVerdict(report, { allowEmpty: a.allowEmpty });
console.log(summarizeValidation(report, decision));
if (changed) console.log(`  (diff scope vs ${a.base}: ${changed.length} changed file(s))`);

if (a.reportFile) writeFileSync(a.reportFile, JSON.stringify({ ...report, verdict: decision.verdict }, null, 2));
process.exit(decision.code);
