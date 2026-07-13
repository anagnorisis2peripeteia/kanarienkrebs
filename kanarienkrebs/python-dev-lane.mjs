// kanarienkrebs — Python runtime-validation lane. Reruns the repo's tests under
// CPython dev mode with deprecation/resource warnings promoted to errors, so latent
// hazards (deprecated APIs, unclosed resources) that a normal run swallows become
// hard failures. The Python analog of the ts-runtime lane: the "strict layer" is
// PYTHONDEVMODE + PYTHONWARNINGS=error::<category>.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const STRICT_ENV = {
  PYTHONDEVMODE: "1",
  PYTHONWARNINGS: "error::DeprecationWarning,error::PendingDeprecationWarning,error::ResourceWarning",
};
// Match a REAL Python warning line (`<Category>Warning: <msg>`, as CPython prints
// `file:line: DeprecationWarning: ...` or a raised-warning traceback ending in
// `DeprecationWarning: ...`), not the mere mention of the word in descriptive text.
const DIAG_RE = /\w*Warning:/;

export function pythonAvailable() {
  const r = spawnSync("python3", ["--version"], { encoding: "utf8" });
  return !r.error && r.status === 0;
}

export function hasPython(repo) {
  return ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt"].some((f) => existsSync(join(repo, f)));
}

export function runUnderDevMode({ repo, testCommand, timeoutMs = 300000 }) {
  const res = spawnSync(testCommand, {
    cwd: repo,
    shell: true,
    encoding: "utf8",
    env: { ...process.env, ...STRICT_ENV },
    timeout: timeoutMs,
    maxBuffer: 1 << 26,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const diagnostics = [];
  const seen = new Set();
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (t && DIAG_RE.test(t) && !seen.has(t)) {
      seen.add(t);
      diagnostics.push({ severity: "warning", source: "python", message: t });
    }
  }
  const timedOut = res.error && res.error.code === "ETIMEDOUT";
  if (!timedOut && res.status && diagnostics.length === 0) {
    diagnostics.push({ severity: "error", source: "python", message: `tests failed (exit ${res.status}) under the dev layer — see raw output` });
  }
  return { exitCode: res.status ?? null, signal: res.signal ?? null, timedOut: !!timedOut, diagnostics, raw: out };
}

/** validate-provider: the canary emits a DeprecationWarning; under the dev layer's
 *  PYTHONWARNINGS=error it MUST raise (nonzero); plain python exits 0. The plain
 *  baseline SCRUBS the strict env (PYTHONDEVMODE/PYTHONWARNINGS) so an ambient value
 *  can't defeat the check — same lesson as the ts lane's NODE_OPTIONS scrub. */
export function validatePythonLayer(canaryPath) {
  const cleanEnv = { ...process.env };
  delete cleanEnv.PYTHONDEVMODE;
  delete cleanEnv.PYTHONWARNINGS;
  const withLayer = spawnSync("python3", [canaryPath], { encoding: "utf8", env: { ...cleanEnv, ...STRICT_ENV } });
  const plain = spawnSync("python3", [canaryPath], { encoding: "utf8", env: cleanEnv });
  return withLayer.status !== 0 && plain.status === 0;
}
