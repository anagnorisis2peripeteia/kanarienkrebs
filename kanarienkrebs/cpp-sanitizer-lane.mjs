// kanarienkrebs — C++ sanitizer lane. Rebuilds & reruns the target's tests under
// AddressSanitizer + UndefinedBehaviorSanitizer (-fsanitize=address,undefined) so
// latent memory-safety / UB hazards (heap/stack overflows, use-after-free, signed
// overflow, misaligned loads) that a normal build silently runs past become hard,
// gate-blocking failures. The C++ analog of the ts-runtime lane: the "strict layer"
// is a set of COMPILE flags (so it must rebuild, unlike the env-only Node/Go/dotnet
// lanes), injected into the caller's build via CXXFLAGS/CFLAGS/LDFLAGS, and an ASan
// report / UBSan "runtime error:" is the diagnostic.
//
// Recover discipline: UBSan recovers by default (prints "runtime error: ..." and
// continues) while ASan aborts on the first fault. We keep that default so a single
// run surfaces EVERY UBSan finding, and rely on the diagnostic scan (not just the
// exit code) to fail closed — any sanitizer line fails the verdict even if the
// process happened to exit 0. ASan faults still abort hard (nonzero / SIGABRT).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir, constants } from "node:os";
import { join } from "node:path";

// The strict layer. Injected into the caller's build (runCpp) and used verbatim by
// the canary compile (validateCppLayer). -g + frame pointers => readable reports.
const SAN_COMPILE = ["-g", "-fno-omit-frame-pointer", "-fsanitize=address,undefined"];
const SAN_LINK = ["-fsanitize=address,undefined"];
// Deterministic runtime behaviour for the canary: ASan aborts on fault; skip LSan
// (unsupported on Apple ASan anyway); UBSan prints stack traces.
const SAN_RUN_ENV = { ASAN_OPTIONS: "abort_on_error=1:detect_leaks=0", UBSAN_OPTIONS: "print_stacktrace=1:halt_on_error=0" };
// Env keys the plain baseline / canary compile MUST scrub so an ambient value can't
// defeat the check — e.g. a preset ASAN_OPTIONS=exitcode=0 that swallows the abort,
// or a CXXFLAGS=-fsanitize=address that secretly sanitises the "plain" build too.
const STRICT_KEYS = ["ASAN_OPTIONS", "UBSAN_OPTIONS", "CXXFLAGS", "CFLAGS", "CPPFLAGS", "LDFLAGS", "CC", "CXX"];
// Match a REAL sanitizer emission — UBSan's "runtime error:", or an ASan/UBSan
// ERROR/SUMMARY banner — not the mere mention of the words in descriptive text.
const DIAG_RE = /runtime error:|(ERROR|SUMMARY): (Address|Undefined(Behavior)?|Memory|Thread|Leak)Sanitizer/;

const SKIP_DIRS = new Set(["node_modules", "bin", "obj", "build", "out", ".git", ".vs", ".idea"]);
const SRC_RE = /\.(cpp|cc|cxx|c\+\+|cu|mm)$/i;
const MAKE_FILES = new Set(["CMakeLists.txt", "Makefile", "GNUmakefile", "makefile"]);

export function cppAvailable() {
  const r = spawnSync("clang++", ["--version"], { encoding: "utf8" });
  return !r.error && r.status === 0;
}

/** A C++ repo iff a build file (CMakeLists.txt/Makefile) or a C++ source file is
 *  present (shallow-recursive; skips heavy/build dirs and dotfiles; depth-bounded
 *  so a huge tree stays cheap). */
export function hasCpp(repo, depth = 4) {
  let entries;
  try {
    entries = readdirSync(repo, { withFileTypes: true });
  } catch {
    return false;
  }
  if (entries.some((e) => e.isFile() && (MAKE_FILES.has(e.name) || SRC_RE.test(e.name)))) return true;
  if (depth <= 0) return false;
  for (const e of entries) {
    if (e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) {
      if (hasCpp(join(repo, e.name), depth - 1)) return true;
    }
  }
  return false;
}

/** Node reports a signal-killed child (ASan's SIGABRT) as status=null; map that to a
 *  conventional 128+signo so the caller sees a non-null nonzero exit (tests DID run). */
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
      diagnostics.push({ severity: "error", source: "cpp-sanitizer", message: t });
    }
  }
  return diagnostics;
}

export function runCpp({ repo, testCommand, timeoutMs = 300000 }) {
  // The caller's build+test command is rerun with the sanitizer flags injected via
  // the standard CXXFLAGS/CFLAGS/LDFLAGS env vars (honoured by make, CMake's initial
  // cache, autotools, …). A command that already builds with -fsanitize is fine too.
  const env = { ...process.env };
  const append = (k, extra) => { env[k] = `${env[k] ?? ""} ${extra}`.trim(); };
  append("CXXFLAGS", SAN_COMPILE.join(" "));
  append("CFLAGS", SAN_COMPILE.join(" "));
  append("LDFLAGS", SAN_LINK.join(" "));
  env.ASAN_OPTIONS = SAN_RUN_ENV.ASAN_OPTIONS;
  env.UBSAN_OPTIONS = SAN_RUN_ENV.UBSAN_OPTIONS;

  const res = spawnSync(testCommand, { cwd: repo, shell: true, encoding: "utf8", env, timeout: timeoutMs, maxBuffer: 1 << 26 });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const diagnostics = scanDiagnostics(out);
  const timedOut = res.error && res.error.code === "ETIMEDOUT";
  const exitCode = exitCodeOf(res);
  // a nonzero/aborted run with no parsed sanitizer line is still a real failure — surface it
  if (!timedOut && exitCode !== null && exitCode !== 0 && diagnostics.length === 0) {
    diagnostics.push({ severity: "error", source: "cpp", message: `build/test failed (exit ${exitCode}) under the sanitizer layer — see raw output` });
  }
  return { exitCode, signal: res.signal ?? null, timedOut: !!timedOut, diagnostics, raw: out };
}

function scrubbedEnv() {
  const env = { ...process.env };
  for (const k of STRICT_KEYS) delete env[k];
  return env;
}

/** validate-provider: compile the canary TWICE from one source — once WITH the
 *  sanitizer flags, once plain — then run each. WITH the layer the canary MUST flip
 *  0 -> nonzero (ASan aborts) AND emit a sanitizer report; PLAIN it exits 0. Live iff
 *  the layer flips. clang++ is invoked with explicit args (it ignores CXXFLAGS), and
 *  the run env scrubs ASAN_OPTIONS/UBSAN_OPTIONS so an ambient value can't mask the
 *  abort. Fail-closed: if the canary can't even be built, the lane is not proven. */
export function validateCppLayer(canaryDir) {
  const src = join(canaryDir, "overflow.cpp");
  if (!existsSync(src)) return false;
  const base = scrubbedEnv();
  const work = mkdtempSync(join(tmpdir(), "kan-cpp-"));
  try {
    const sanBin = join(work, "san");
    const plainBin = join(work, "plain");
    const compileBase = ["-std=c++17", "-O1"];
    const sanBuild = spawnSync("clang++", [...compileBase, ...SAN_COMPILE, ...SAN_LINK, src, "-o", sanBin], { encoding: "utf8", env: base });
    if (sanBuild.error || sanBuild.status !== 0) return false;
    const plainBuild = spawnSync("clang++", [...compileBase, src, "-o", plainBin], { encoding: "utf8", env: base });
    if (plainBuild.error || plainBuild.status !== 0) return false;

    const sanRun = spawnSync(sanBin, [], { encoding: "utf8", env: { ...base, ...SAN_RUN_ENV } });
    const plainRun = spawnSync(plainBin, [], { encoding: "utf8", env: base });
    const sanOut = `${sanRun.stdout ?? ""}${sanRun.stderr ?? ""}`;
    const sanFlipped = (sanRun.status !== 0 || sanRun.signal != null) && DIAG_RE.test(sanOut);
    return sanFlipped && plainRun.status === 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
