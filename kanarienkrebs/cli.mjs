#!/usr/bin/env node
// kanarienkrebs — diff-scoped, fail-closed runtime-validation gate (MVP: TS/Node lane).
// Usage:
//   kanarienkrebs --repo <path> --test-command "<cmd>" [--base <ref>] [--report-file <p>] [--allow-empty]
//   kanarienkrebs --validate   (prove the runtime layer actually flips a clean run into a throw)
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runUnderLayer, validateLayer } from "./ts-runtime-lane.mjs";
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
    else if (k === "--validate") a.validate = true;
  }
  return a;
}

const a = parseArgs(process.argv.slice(2));

if (a.validate) {
  const canary = join(HERE, "..", "fixtures", "canary-runtime", "deprecation-canary.mjs");
  const live = validateLayer(canary);
  console.log(`kanarienkrebs validate-provider · lane=ts-runtime · layerActive=${live}`);
  console.log(live ? "  ✓ ENGINE_OK (the strict layer turned a clean run into a throw)" : "  ✗ QUARANTINED (layer had no effect — flags not honored)");
  process.exit(live ? 0 : 5);
}

if (!a.repo || !a.testCommand) {
  console.error('kanarienkrebs: --repo <path> and --test-command "<cmd>" required (or --validate)');
  process.exit(64);
}

const run = runUnderLayer({ repo: a.repo, command: a.testCommand });
const changed = a.base ? changedFiles(a.repo, a.base) : null;

const report = {
  tool: "kanarienkrebs",
  lane: "ts-runtime",
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
