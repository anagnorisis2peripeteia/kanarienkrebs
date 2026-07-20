# kanarienkrebs

A diff-scoped, fail-closed **runtime-validation gate**. kanarienkrebs reruns a
target repo's *existing* test command under a stricter Node runtime layer
(`--unhandled-rejections=throw`, `--throw-deprecation`) so latent hazards that
a lax run swallows — unhandled promise rejections, deprecated/experimental API
use — become hard, gate-blocking failures instead of silent warnings.

## Point-and-go

Unlike its sibling `einsiedlerkrebs` (property-based testing, which requires
you to *author* properties), kanarienkrebs needs **no authoring**. Point it at
a repo and a test command; it reruns exactly what you already run, just under
a stricter runtime, and reports any new diagnostic surfaced on the exercised
code.

## Fail-closed, not fail-open

A PASS from kanarienkrebs is only trustworthy if the strict layer is
*proven* live — that it can actually catch something. The
`fixtures/canary-runtime/deprecation-canary.mjs` fixture is a deliberately
planted deprecation warning: a clean run exits 0, but under the strict layer
it MUST throw and exit nonzero. `--validate` runs this canary and refuses to
report a real result if the layer had no effect (verdict `QUARANTINED`,
exit code 5). `scripts/validate-provider.mjs` is the CI-facing wrapper that
asserts this canary is caught before the gate is trusted at all.

## Usage

```sh
# Prove the runtime layer is genuinely live (planted canary must be caught)
kanarienkrebs --validate

# Show a scaffolded C# lane validation path (Roslyn-instrumentation phase-1)
kanarienkrebs --validate --lane csharp-roslyn

# Rerun a repo's test command under the strict layer
kanarienkrebs --repo <path> --test-command "<cmd>" [--base <ref>] [--report-file <path>] [--allow-empty]
```

- `--repo <path>` — target repository to validate (required unless `--validate`).
- `--test-command "<cmd>"` — the command to rerun under the strict layer (required unless `--validate`).
- `--base <ref>` — optional git ref; when set, the changed-file set vs `<ref>` is computed and reported alongside the verdict (diff-scoping).
- `--report-file <path>` — optional path to write the full JSON report + verdict.
- `--allow-empty` — treat "no tests exercised" as `PASS_EMPTY` (exit 0) instead of `NO_EXERCISE` (exit 3).
- `--validate` — run the validate-provider canary; exits 0 (`ENGINE_OK`) only if the strict layer actually flips the canary's clean run into a throw, else exits 5 (`QUARANTINED`).

## Verdicts

| Verdict       | Exit | Meaning                                                          |
|---------------|------|-------------------------------------------------------------------|
| `PASS`        | 0    | Tests ran under the strict layer with no new diagnostics.        |
| `PASS_EMPTY`  | 0    | Nothing was exercised, but `--allow-empty` was set.               |
| `NO_EXERCISE` | 3    | Nothing was exercised and `--allow-empty` was not set.            |
| `FAIL`        | 2    | The strict layer surfaced one or more diagnostics.                |
| `ERROR`       | 6    | The run timed out.                                                 |
| `QUARANTINED` | 5    | The runtime layer could not be proven live — result is untrusted. |

## Supported Lanes

| Lane | Description |
|------|-------------|
| `ts` | Node runtime with strict runtime flags (`--unhandled-rejections=throw`, `--throw-deprecation`). |
| `go` | Go race-instrumented test execution. |
| `python` | Python deprecation-focused runtime profile. |
| `dotnet` | .NET runtime strict globalization layer (`DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`). |
| `csharp-roslyn` | **Scaffold only**: explicit C#/.NET lane skeleton; Roslyn runtime instrumentation not yet implemented. |
| `cpp` | C++ sanitizer layer (`-fsanitize=address,undefined`). |
| `metal` | Metal layer validation via `MTL_SHADER_VALIDATION=1` and build tags. |

## Layout

```
core/report.mjs        — verdict logic + summary formatting (validation-only functions)
core/diff.mjs           — shared git diff-scoping helpers
kanarienkrebs/cli.mjs    — CLI entrypoint
kanarienkrebs/ts-runtime-lane.mjs — the strict-runtime lane (spawns the test command, parses diagnostics)
kanarienkrebs/csharp-roslyn-lane.mjs — scaffold C#/.NET lane boundary (phase-1 fail-closed placeholder)
fixtures/canary-runtime/ — the validate-provider canary fixture
fixtures/canary-csharp-roslyn/ — scaffold marker for the csharp-roslyn lane
test/                    — node:test suite
scripts/validate-provider.mjs — CI-facing gate: asserts the canary is caught
```

## Development

```sh
npm test               # run the test suite
npm run check           # node --check over all source files
npm run validate:provider  # prove the runtime layer is live
npm run lint             # alias for check
```

No external dependencies — everything runs on Node's built-in `node:test` and
`node:child_process`.
