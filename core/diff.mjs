// Shared diff-scoping — the marmorkrebs `--base` spine. Given a repo and a base
// ref, return the set of changed files (branch commits since merge-base + staged
// + unstaged + untracked). Non-git repos degrade to null so the caller can fall
// back to explicit `--modules` targeting instead of silently scoping to nothing.
import { execFileSync } from "node:child_process";

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

export function repoHead(repo) {
  try {
    return git(repo, ["rev-parse", "HEAD"]);
  } catch {
    return null;
  }
}

/** Changed files vs <base>, or null if <repo> is not a git checkout. */
export function changedFiles(repo, base) {
  try {
    const lines = new Set();
    const add = (out) => out.split("\n").filter(Boolean).forEach((f) => lines.add(f));
    // merge-base…HEAD committed changes, then working-tree + staged, then untracked
    add(git(repo, ["diff", "--name-only", `${base}...HEAD`]));
    add(git(repo, ["diff", "--name-only"]));
    add(git(repo, ["diff", "--name-only", "--staged"]));
    add(git(repo, ["ls-files", "--others", "--exclude-standard"]));
    return [...lines];
  } catch {
    return null; // not a git repo, or base ref missing — caller handles fail-closed
  }
}

/** Deterministic seed derived from HEAD so a SHA change re-runs reproducibly. */
export function seedFromHead(repo, fallback) {
  const head = repoHead(repo);
  if (!head) return fallback;
  return parseInt(head.slice(0, 8), 16) >>> 0;
}
