import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { changedFiles, seedFromHead, repoHead } from "../core/diff.mjs";

function sh(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function makeTempDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

// ---- non-git dir behavior ----

test("changedFiles: returns null on a non-git dir", () => {
  const dir = makeTempDir("krebs-nogit-diff-");
  try {
    assert.equal(changedFiles(dir, "main"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("repoHead: returns null on a non-git dir", () => {
  const dir = makeTempDir("krebs-nogit-head-");
  try {
    assert.equal(repoHead(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("seedFromHead: falls back when repo is not a git repo", () => {
  const dir = makeTempDir("krebs-nogit-seed-");
  try {
    const fallback = 12345;
    assert.equal(seedFromHead(dir, fallback), fallback);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- real temp git repo ----

function makeTempRepo() {
  const dir = makeTempDir("krebs-realgit-");
  sh(dir, ["init", "-q"]);
  sh(dir, ["config", "user.email", "test@example.com"]);
  sh(dir, ["config", "user.name", "Test"]);
  writeFileSync(path.join(dir, "committed.txt"), "hello\n");
  sh(dir, ["add", "committed.txt"]);
  sh(dir, ["commit", "-q", "-m", "initial commit"]);
  return dir;
}

test("changedFiles: on a real git repo, reports edited/staged/untracked files vs base", () => {
  const dir = makeTempRepo();
  try {
    const base = sh(dir, ["rev-parse", "HEAD"]).trim();

    // edit the committed file (unstaged working-tree change)
    writeFileSync(path.join(dir, "committed.txt"), "hello again\n");

    // add a new staged file
    writeFileSync(path.join(dir, "staged.txt"), "staged\n");
    sh(dir, ["add", "staged.txt"]);

    // add a new untracked file
    writeFileSync(path.join(dir, "untracked.txt"), "untracked\n");

    const files = changedFiles(dir, base);
    assert.ok(Array.isArray(files));
    assert.ok(files.includes("committed.txt"), `expected committed.txt in ${JSON.stringify(files)}`);
    assert.ok(files.includes("staged.txt"), `expected staged.txt in ${JSON.stringify(files)}`);
    assert.ok(files.includes("untracked.txt"), `expected untracked.txt in ${JSON.stringify(files)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("changedFiles: on a real git repo, includes files from committed changes since base (merge-base...HEAD)", () => {
  const dir = makeTempRepo();
  try {
    const base = sh(dir, ["rev-parse", "HEAD"]).trim();

    writeFileSync(path.join(dir, "second.txt"), "second\n");
    sh(dir, ["add", "second.txt"]);
    sh(dir, ["commit", "-q", "-m", "second commit"]);

    const files = changedFiles(dir, base);
    assert.ok(Array.isArray(files));
    assert.ok(files.includes("second.txt"), `expected second.txt in ${JSON.stringify(files)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("seedFromHead: derives a deterministic seed from a real repo's HEAD", () => {
  const dir = makeTempRepo();
  try {
    const head = repoHead(dir);
    assert.ok(head);
    const expected = parseInt(head.slice(0, 8), 16) >>> 0;
    assert.equal(seedFromHead(dir, 999), expected);
    // deterministic: calling again gives the same seed
    assert.equal(seedFromHead(dir, 999), expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
