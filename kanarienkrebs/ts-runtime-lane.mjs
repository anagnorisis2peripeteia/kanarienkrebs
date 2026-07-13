// kanarienkrebs — TS/Node runtime-validation lane. Reruns the target's test command
// under Node's strictest runtime flags so latent hazards (unhandled rejections,
// deprecated/experimental API use) that a lax run swallows become hard failures, and
// reports any diagnostic on the exercised surface. Env-flag driven — the Node analog
// of MTL_SHADER_VALIDATION on the Metal lane: no rebuild, wraps tests you already run.
import { spawnSync } from "node:child_process";

const STRICT = ["--unhandled-rejections=throw", "--throw-deprecation"];
const DIAG_RE = /(UnhandledPromiseRejection|DeprecationWarning|ExperimentalWarning|ResourceWarning|Warning:)/;

export function runUnderLayer({ repo, command, timeoutMs = 120000 }) {
  const layer = STRICT.join(" ");
  const res = spawnSync(command, {
    cwd: repo,
    shell: true,
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} ${layer}`.trim() },
    timeout: timeoutMs,
    maxBuffer: 1 << 25,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const diagnostics = [];
  const seen = new Set();
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (t && DIAG_RE.test(t) && !seen.has(t)) {
      seen.add(t);
      diagnostics.push({ severity: "warning", source: "node", message: t });
    }
  }
  const timedOut = res.error && res.error.code === "ETIMEDOUT";
  // a nonzero exit that isn't a plain test failure often means the layer threw — surface it
  if (!timedOut && res.status && diagnostics.length === 0) {
    diagnostics.push({ severity: "error", source: "node", message: `nonzero exit ${res.status} under strict layer (see raw output)` });
  }
  return { exitCode: res.status ?? null, signal: res.signal ?? null, timedOut: !!timedOut, diagnostics, raw: out };
}

/** validate-provider: the canary emits a DeprecationWarning; under --throw-deprecation
 *  the process MUST exit nonzero. Nonzero => the layer is genuinely live. */
export function validateLayer(canaryPath) {
  // The "plain" baseline MUST be genuinely unflagged. NODE_OPTIONS is inherited from the
  // environment, so if the caller already runs under strict flags (kanarienkrebs gating
  // ITSELF, or any CI that sets NODE_OPTIONS) an un-scrubbed plain run would also throw
  // on the canary's deprecation and validateLayer would falsely report the layer dead —
  // a spurious QUARANTINE. Strip NODE_OPTIONS from both children and drive the strict run
  // purely via argv flags, so the check is independent of the ambient environment.
  const cleanEnv = { ...process.env };
  delete cleanEnv.NODE_OPTIONS;
  const withLayer = spawnSync(process.execPath, [...STRICT, canaryPath], { encoding: "utf8", env: cleanEnv });
  const plain = spawnSync(process.execPath, [canaryPath], { encoding: "utf8", env: cleanEnv });
  // live iff the strict flags flip a clean(0) run into a throw(nonzero)
  return withLayer.status !== 0 && plain.status === 0;
}
