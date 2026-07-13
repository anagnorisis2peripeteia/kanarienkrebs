import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { validateGoLayer, runGoRace, goAvailable, hasGoMod } from "../kanarienkrebs/go-race-lane.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANARY_DIR = join(HERE, "..", "fixtures", "canary-go");
const skip = goAvailable() ? false : "go not on PATH";

test("hasGoMod detects a Go module vs a non-Go dir", () => {
  assert.equal(hasGoMod(CANARY_DIR), true);
  assert.equal(hasGoMod(join(HERE, "..")), false); // the kanarienkrebs repo has no go.mod
});

test("validateGoLayer is true for the race canary (detector flips pass -> race)", { skip }, () => {
  assert.equal(validateGoLayer(CANARY_DIR), true);
});

test("runGoRace surfaces the DATA RACE on the canary module", { skip }, () => {
  const r = runGoRace({ repo: CANARY_DIR });
  assert.notEqual(r.exitCode, 0);
  assert.ok(
    r.diagnostics.some((d) => d.source === "go-race" && /DATA RACE/.test(d.message)),
    "expected a DATA RACE diagnostic",
  );
});
