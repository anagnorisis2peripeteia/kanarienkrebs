# Contributing

Thanks for looking at `kanarienkrebs`. This is a small, single-tool repo — keep
changes proportional.

## Ground rules

1. **Fail-closed is non-negotiable.** Any change to `core/report.mjs` or the
   verdict logic in `kanarienkrebs/cli.mjs` must keep every degenerate state
   (no tests exercised, timeout, unvalidated layer) mapped to a non-zero,
   non-`PASS` exit code. If your change makes a new situation return exit
   `0`/`PASS`, justify it explicitly in the PR description or it will be
   rejected.
2. **validate-provider is load-bearing, not decorative.** If you touch
   `kanarienkrebs/ts-runtime-lane.mjs`, re-run the `--validate` canary and
   paste the output in your PR. A lane that can't prove its own layer is live
   must quarantine itself (exit `5`), not pass by default.
3. **Diff-scoping stays evidence, not decoration.** `--base` support
   (`core/diff.mjs`'s `changedFiles`) is there so a gate can show the surface
   it actually covered. Don't let new features quietly widen a run's scope
   without surfacing that in the report.
4. **The canary fixture stays deliberately failing.** `fixtures/canary-runtime/deprecation-canary.mjs`
   emits a deprecation warning specifically so `--throw-deprecation` turns it
   into a throw. A fixture that can't fail on demand can't prove the gate
   catches anything.

## Local dev loop

```bash
node kanarienkrebs/cli.mjs --validate
node kanarienkrebs/cli.mjs --repo . --test-command "npm test"
```

The `--validate` run must print `ENGINE_OK` / exit `0` before you touch
anything downstream of it — if it comes back `QUARANTINED`, the lane itself is
broken and no other result from it can be trusted.

## Tests

```bash
npm test
npm run check
npm run validate:provider
```

All three must pass before opening a PR.
