// kanarienkrebs — Metal shader-validation lane (the flagship). Reruns the target's
// test command under Metal Shader Validation + the Metal debug layer
// (MTL_SHADER_VALIDATION=1 MTL_DEBUG_LAYER=1) so GPU-side memory hazards in compute/
// render kernels — out-of-bounds device/threadgroup buffer access, etc. — that a
// normal run silently corrupts past are reported as hard diagnostics. The Metal
// analog of the ts-runtime lane: the "strict layer" is an env-only GPU validation
// mode (no rebuild, wraps the tests you already run), and an "Invalid device store/
// load ..." report is the diagnostic.
//
// IMPORTANT (proven on this Mac, macOS 26 / Apple GPU): shader validation reports the
// OOB to STDERR but does NOT set commandBuffer.error or abort — the offending run
// still exits 0. So the flip is keyed on the validation DIAGNOSTIC (present only
// under MTL_SHADER_VALIDATION=1), NOT the exit code. This mirrors how the go/dotnet/
// python lanes fail closed on parsed diagnostics regardless of exit status.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir, constants } from "node:os";
import { join } from "node:path";

// The strict layer: enable Metal Shader Validation, the debug layer, and route the
// validation report to stderr so we can capture it from a headless test process.
const STRICT_ENV = {
  MTL_SHADER_VALIDATION: "1",
  MTL_DEBUG_LAYER: "1",
  MTL_SHADER_VALIDATION_REPORT_TO_STDERR: "1",
};
// Env keys the plain baseline MUST scrub so an ambient value can't defeat the check
// (e.g. a preset MTL_SHADER_VALIDATION=1 would make the "plain" run also report the
// OOB, collapsing the flip into a spurious QUARANTINE).
const STRICT_KEYS = [
  "MTL_SHADER_VALIDATION",
  "MTL_DEBUG_LAYER",
  "MTL_SHADER_VALIDATION_REPORT_TO_STDERR",
  "MTL_DEBUG_LAYER_ERROR_MODE",
  "MTL_SHADER_VALIDATION_ERROR_MODE",
];
// Match a REAL Metal validation FAULT — an out-of-bounds device/buffer access, a
// failed debug-layer assertion, an aborted command buffer — but NOT the benign
// "Metal API/GPU Validation Enabled" banner that every validation run prints.
const DIAG_RE =
  /Invalid (device|buffer|constant|threadgroup|texture) (load|store)|\bout[- ]of[- ]bounds\b|failed assertion|Execution of the command buffer was aborted|command buffer error|Metal.*[Vv]alidation.*(error|failure|failed)|MTLValidation(Error|Failure)/;

const SKIP_DIRS = new Set(["node_modules", "bin", "obj", "build", "out", ".git", ".vs", ".idea"]);
const METAL_RE = /\.metal$/i;

export function metalAvailable() {
  // Gate on the Metal toolchain: `xcrun -f metal` resolves the compiler the runtime
  // harness (and any repo's .metal build) needs, and is absent off-macOS => SKIP.
  const r = spawnSync("xcrun", ["-f", "metal"], { encoding: "utf8" });
  return !r.error && r.status === 0;
}

/** A Metal repo iff a `.metal` shader source is present (shallow-recursive; skips
 *  heavy/build dirs and dotfiles; depth-bounded so a huge tree stays cheap). */
export function hasMetal(repo, depth = 4) {
  let entries;
  try {
    entries = readdirSync(repo, { withFileTypes: true });
  } catch {
    return false;
  }
  if (entries.some((e) => e.isFile() && METAL_RE.test(e.name))) return true;
  if (depth <= 0) return false;
  for (const e of entries) {
    if (e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) {
      if (hasMetal(join(repo, e.name), depth - 1)) return true;
    }
  }
  return false;
}

/** Node reports a signal-killed child as status=null; map that to 128+signo so the
 *  caller sees a non-null nonzero exit (the tests DID run). */
function exitCodeOf(res) {
  if (res.status !== null && res.status !== undefined) return res.status;
  if (res.signal) return 128 + (constants.signals[res.signal] ?? 0);
  return null;
}

function scanDiagnostics(out) {
  const diagnostics = [];
  const seen = new Set();
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (t && DIAG_RE.test(t) && !seen.has(t)) {
      seen.add(t);
      diagnostics.push({ severity: "error", source: "metal-validation", message: t });
    }
  }
  return diagnostics;
}

export function runMetal({ repo, testCommand, timeoutMs = 300000 }) {
  // The caller's test command is rerun with shader validation enabled via env; the
  // MTL_* vars propagate to every child of the shell, so any Metal work the tests do
  // is validated. A validation fault is reported on stderr and parsed below.
  const res = spawnSync(testCommand, {
    cwd: repo,
    shell: true,
    encoding: "utf8",
    env: { ...process.env, ...STRICT_ENV },
    timeout: timeoutMs,
    maxBuffer: 1 << 26,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const diagnostics = scanDiagnostics(out);
  const timedOut = res.error && res.error.code === "ETIMEDOUT";
  const exitCode = exitCodeOf(res);
  // a nonzero/aborted run with no parsed validation line is still a real failure — surface it
  if (!timedOut && exitCode !== null && exitCode !== 0 && diagnostics.length === 0) {
    diagnostics.push({ severity: "error", source: "metal", message: `tests failed (exit ${exitCode}) under the shader-validation layer — see raw output` });
  }
  return { exitCode, signal: res.signal ?? null, timedOut: !!timedOut, diagnostics, raw: out };
}

function scrubbedEnv() {
  const env = { ...process.env };
  for (const k of STRICT_KEYS) delete env[k];
  return env;
}

/** validate-provider: build the ObjC++ harness once, then run it twice from the same
 *  binary. WITH shader validation the kernel's out-of-bounds device store MUST be
 *  reported ("Invalid device store ..."); PLAIN (strict env scrubbed) it is not, and
 *  the run exits 0. Live iff the diagnostic appears only under validation. Fail-closed:
 *  if the harness can't be built (no Metal toolchain), the lane is not proven. */
export function validateMetalLayer(canaryDir) {
  const harness = join(canaryDir, "harness.mm");
  const kernel = join(canaryDir, "kernel.metal");
  if (!existsSync(harness) || !existsSync(kernel)) return false;
  const base = scrubbedEnv();
  const work = mkdtempSync(join(tmpdir(), "kan-metal-"));
  try {
    const bin = join(work, "harness");
    const build = spawnSync(
      "xcrun",
      ["clang++", "-std=c++17", "-fobjc-arc", "-framework", "Metal", "-framework", "Foundation", harness, "-o", bin],
      { encoding: "utf8", env: base },
    );
    if (build.error || build.status !== 0) return false;

    const withRun = spawnSync(bin, [kernel], { encoding: "utf8", env: { ...base, ...STRICT_ENV } });
    const plainRun = spawnSync(bin, [kernel], { encoding: "utf8", env: base });
    const withOut = `${withRun.stdout ?? ""}${withRun.stderr ?? ""}`;
    const plainOut = `${plainRun.stdout ?? ""}${plainRun.stderr ?? ""}`;
    const withHit = DIAG_RE.test(withOut);
    const plainHit = DIAG_RE.test(plainOut);
    // live iff validation surfaces a fault the plain run does not, and plain stayed clean
    return withHit && !plainHit && plainRun.status === 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
