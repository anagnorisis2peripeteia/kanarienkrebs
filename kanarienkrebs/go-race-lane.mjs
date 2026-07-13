// kanarienkrebs — Go runtime-validation lane. Reruns the repo's Go tests under the
// race detector (`go test -race`) so unsynchronized concurrent access that a normal
// run swallows becomes a hard failure. The Go analog of the ts-runtime lane: the
// "strict layer" is the -race flag, and a DATA RACE is the diagnostic.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function hasGoMod(repo) {
  return existsSync(join(repo, "go.mod"));
}

export function goAvailable() {
  const r = spawnSync("go", ["version"], { encoding: "utf8" });
  return !r.error && r.status === 0;
}

function parseRaces(out) {
  const diagnostics = [];
  const seen = new Set();
  const lines = out.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/WARNING: DATA RACE/.test(lines[i])) {
      // grab the first "Read/Write at 0x... by goroutine" location near the header
      const loc = lines.slice(i, i + 10).find((l) => /\b(Read|Write) at /.test(l));
      const msg = `DATA RACE${loc ? ` — ${loc.trim()}` : ""}`;
      if (!seen.has(msg)) {
        seen.add(msg);
        diagnostics.push({ severity: "error", source: "go-race", message: msg });
      }
    }
  }
  return diagnostics;
}

export function runGoRace({ repo, testCommand, timeoutMs = 300000 }) {
  // testCommand overrides (e.g. scope to changed packages); default = whole module.
  const res = testCommand
    ? spawnSync(testCommand, { cwd: repo, shell: true, encoding: "utf8", timeout: timeoutMs, maxBuffer: 1 << 26 })
    : spawnSync("go", ["test", "-race", "./..."], { cwd: repo, encoding: "utf8", timeout: timeoutMs, maxBuffer: 1 << 26 });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const diagnostics = parseRaces(out);
  const timedOut = res.error && res.error.code === "ETIMEDOUT";
  // a nonzero exit with no detected race is a build/test failure — surface it, don't hide it
  if (!timedOut && res.status && diagnostics.length === 0) {
    diagnostics.push({ severity: "error", source: "go", message: `go test failed (exit ${res.status}) under -race — see raw output` });
  }
  return { exitCode: res.status ?? null, signal: res.signal ?? null, timedOut: !!timedOut, diagnostics, raw: out };
}

/** validate-provider: the canary has a real race. `go test -race` MUST flag it
 *  (nonzero + DATA RACE) while plain `go test` passes => the detector is live. */
export function validateGoLayer(canaryDir) {
  const withRace = spawnSync("go", ["test", "-race", "./..."], { cwd: canaryDir, encoding: "utf8" });
  const plain = spawnSync("go", ["test", "./..."], { cwd: canaryDir, encoding: "utf8" });
  const racedetected = withRace.status !== 0 && /WARNING: DATA RACE/.test(`${withRace.stdout}${withRace.stderr}`);
  return racedetected && plain.status === 0;
}
