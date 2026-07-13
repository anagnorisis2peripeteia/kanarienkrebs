// kanarienkrebs — .NET runtime-validation lane. Reruns the repo's test command
// under invariant globalization (DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1) so latent
// host-culture / ICU dependencies that a normal run swallows become hard failures.
// The .NET analog of the ts-runtime lane: the "strict layer" is a runtime MODE env
// var (no rebuild, wraps the tests you already run), and a CultureNotFoundException
// — code reaching for a named culture that only exists outside invariant mode — is
// the diagnostic. This is the exact failure such code hits when it is later deployed
// to an invariant-globalization environment (minimal containers, Native AOT, trimmed
// apps), surfaced early instead of in production.
//
// Why not <ThrowUnobservedTaskExceptions>? On .NET 8 that runtimeconfig switch is
// read (AppContext reports it true) and the UnobservedTaskException event fires, but
// the process does NOT exit nonzero — it fails to flip clean->fail, so it cannot back
// a fail-closed gate. Invariant globalization flips deterministically and is env-only,
// which also makes it deliverable to an arbitrary `dotnet test` without editing the
// target project (the runtimeconfig property is not settable via DOTNET_/MSBuild env).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The strict layer: switch the runtime to globalization-invariant mode. Documented
// runtime knob; cheap (if anything faster than ICU), unlike DOTNET_GCStress.
const STRICT_ENV = { DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "1" };
// Env keys the plain baseline MUST scrub so an ambient value can't defeat the check.
const STRICT_KEYS = ["DOTNET_SYSTEM_GLOBALIZATION_INVARIANT", "DOTNET_SYSTEM_GLOBALIZATION_PREDEFINEDCULTURESONLY"];
// Match a REAL .NET fault emission — a thrown-exception line (`<Ns>.<X>Exception: msg`,
// which always carries the colon), the runtime's unhandled-exception banner, or the
// `dotnet test` failure summary — not the mere mention of the word in descriptive text.
const DIAG_RE = /\w*Exception:|Unhandled exception|Failed!\s+-\s+Failed:/;

const SKIP_DIRS = new Set(["node_modules", "bin", "obj", "packages", ".vs", ".idea"]);
const PROJECT_RE = /\.(sln|csproj|fsproj|vbproj)$/i;

export function dotnetAvailable() {
  const r = spawnSync("dotnet", ["--version"], { encoding: "utf8" });
  return !r.error && r.status === 0;
}

/** A .NET repo iff a solution or project file is present (shallow-recursive; skips
 *  heavy/build dirs and dotfiles). Depth-bounded so a huge tree stays cheap. */
export function hasDotnet(repo, depth = 4) {
  let entries;
  try {
    entries = readdirSync(repo, { withFileTypes: true });
  } catch {
    return false;
  }
  if (entries.some((e) => e.isFile() && PROJECT_RE.test(e.name))) return true;
  if (depth <= 0) return false;
  for (const e of entries) {
    if (e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) {
      if (hasDotnet(join(repo, e.name), depth - 1)) return true;
    }
  }
  return false;
}

export function runDotnet({ repo, testCommand, timeoutMs = 300000 }) {
  // Default = the whole solution's tests; testCommand overrides (e.g. scope to a project).
  const cmd = testCommand ?? "dotnet test";
  const res = spawnSync(cmd, {
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
      diagnostics.push({ severity: "error", source: "dotnet", message: t });
    }
  }
  const timedOut = res.error && res.error.code === "ETIMEDOUT";
  // a nonzero exit with no parsed diagnostic is still a real failure — surface it
  if (!timedOut && res.status && diagnostics.length === 0) {
    diagnostics.push({ severity: "error", source: "dotnet", message: `dotnet tests failed (exit ${res.status}) under the invariant-globalization layer — see raw output` });
  }
  return { exitCode: res.status ?? null, signal: res.signal ?? null, timedOut: !!timedOut, diagnostics, raw: out };
}

function cleanEnv() {
  const env = { ...process.env };
  for (const k of STRICT_KEYS) delete env[k];
  return env;
}

/** validate-provider: build the canary once, then run it twice from the same binary.
 *  WITH the invariant layer it MUST throw CultureNotFoundException (nonzero); PLAIN,
 *  with the strict env SCRUBBED, it exits 0. Live iff the layer flips 0 -> nonzero.
 *  The scrub (same lesson as the ts/python lanes) keeps the plain baseline genuinely
 *  unstrict even when kanarienkrebs — or CI — already runs under an invariant env.
 *  Fail-closed: if the canary can't even be built, the lane is not proven (returns
 *  false => QUARANTINED) rather than trusted. */
export function validateDotnetLayer(canaryDir) {
  const outDir = join(canaryDir, "bin", "kanarienkrebs-out");
  const build = spawnSync(
    "dotnet",
    ["build", canaryDir, "-c", "Release", "-o", outDir, "-v", "quiet", "--nologo"],
    { cwd: canaryDir, encoding: "utf8", maxBuffer: 1 << 26 },
  );
  if (build.error || build.status !== 0) return false;
  const dll = join(outDir, "canary.dll");
  if (!existsSync(dll)) return false;
  const base = cleanEnv();
  const withLayer = spawnSync("dotnet", [dll], { encoding: "utf8", env: { ...base, ...STRICT_ENV }, maxBuffer: 1 << 26 });
  const plain = spawnSync("dotnet", [dll], { encoding: "utf8", env: base, maxBuffer: 1 << 26 });
  return withLayer.status !== 0 && plain.status === 0;
}
