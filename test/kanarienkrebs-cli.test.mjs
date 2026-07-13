import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const CLI = join(REPO_ROOT, "kanarienkrebs", "cli.mjs");

test("cli --validate exits 0", () => {
  const res = spawnSync(process.execPath, [CLI, "--validate"], { encoding: "utf8" });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /ENGINE_OK/);
});

test("cli real run with trivial passing test-command exits 0 with PASS", () => {
  const res = spawnSync(
    process.execPath,
    [CLI, "--repo", REPO_ROOT, "--test-command", 'node -e "process.exit(0)"'],
    { encoding: "utf8" },
  );
  assert.equal(res.status, 0);
  assert.match(res.stdout, /PASS/);
});
