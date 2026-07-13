# Security Policy

`kanarienkrebs` is a PR-gate tool that executes code as part of its normal
operation: it re-runs your repo's own test command (`--test-command`) via
`child_process.spawnSync` with a modified `NODE_OPTIONS`.

This tool is designed to be pointed at code you already trust enough to
test/run in CI — it does not sandbox or isolate the target repo. Treat
`--repo` and `--test-command` the same way you'd treat any other CI step that
runs `npm test`: don't point them at untrusted code.

## Fail-closed is a security property, not just a correctness one

kanarienkrebs is built around the same discipline as its sibling
[marmorkrebs](https://github.com/anagnorisis2peripeteia/marmorkrebs): every
degenerate state — zero tests exercised, a layer that can't be proven live, a
timeout — is an explicit non-passing verdict with its own exit code, never a
silent `PASS`. If you find a code path where a broken or tampered layer can
still report `PASS`/exit `0`, that's a security bug in this repo (a gate that
can be silently defeated is worse than no gate), not just a bug — please
report it as below.

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue:

- Email: cameron.beeley@gmail.com
- Include: the command line that triggers the issue, and whether it results
  in a false `PASS`/exit `0`.

We'll acknowledge within a few days. There's no bug bounty — this is a small,
single-maintainer OSS project — but we take fail-closed violations seriously
and will credit reporters in the fix commit unless you ask otherwise.

## Supported versions

Pre-1.0: only the latest commit on `main` is supported. There is no LTS
branch yet.
