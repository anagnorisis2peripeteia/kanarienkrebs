import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { validateDotnetLayer, runDotnet, dotnetAvailable, hasDotnet } from "../kanarienkrebs/dotnet-runtime-lane.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANARY_DIR = join(HERE, "..", "fixtures", "canary-dotnet");
const skip = dotnetAvailable() ? false : "dotnet not on PATH";

test("hasDotnet detects a project-file marker vs a non-dotnet dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "kan-dotnet-"));
  try {
    assert.equal(hasDotnet(dir), false);
    writeFileSync(join(dir, "app.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk\" />\n");
    assert.equal(hasDotnet(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hasDotnet finds the canary's csproj fixture", () => {
  assert.equal(hasDotnet(CANARY_DIR), true);
});

test("validateDotnetLayer is true for the culture canary (invariant layer flips 0 -> throw)", { skip }, () => {
  assert.equal(validateDotnetLayer(CANARY_DIR), true);
});

test("validateDotnetLayer is robust to ambient DOTNET_SYSTEM_GLOBALIZATION_INVARIANT (regression: plain baseline scrubs the strict env)", { skip }, () => {
  const saved = process.env.DOTNET_SYSTEM_GLOBALIZATION_INVARIANT;
  process.env.DOTNET_SYSTEM_GLOBALIZATION_INVARIANT = "1";
  try {
    assert.equal(validateDotnetLayer(CANARY_DIR), true);
  } finally {
    if (saved === undefined) delete process.env.DOTNET_SYSTEM_GLOBALIZATION_INVARIANT;
    else process.env.DOTNET_SYSTEM_GLOBALIZATION_INVARIANT = saved;
  }
});

test("runDotnet surfaces the CultureNotFoundException on the canary under the invariant layer", { skip }, () => {
  const r = runDotnet({ repo: CANARY_DIR, testCommand: `dotnet run --project "${CANARY_DIR}" -c Release` });
  assert.notEqual(r.exitCode, 0);
  assert.ok(
    r.diagnostics.some((d) => d.source === "dotnet" && /Exception|failed/i.test(d.message)),
    "expected a dotnet diagnostic",
  );
});
