import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dirtyPaths, recordCandidate } from "../scripts/qualify-head.ts";

const git = (cwd, ...args) => {
  const out = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout;
};

test("dirty files keep their first character and name a rename's new path", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-qualify-status-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q");
  for (const name of ["README.md", "old name.txt"]) fs.writeFileSync(path.join(root, name), `${name}\n`);
  git(root, "add", ".");
  git(root, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "init");
  fs.appendFileSync(path.join(root, "README.md"), "changed\n");
  git(root, "mv", "old name.txt", "new name.txt");
  fs.writeFileSync(path.join(root, "untracked.txt"), "x\n");
  const status = git(root, "status", "--porcelain=v1", "-z", "--untracked-files=normal");
  assert.ok(status.startsWith(" M README.md"), status);
  assert.deepEqual(dirtyPaths(status), ["README.md", "new name.txt", "untracked.txt"]);
  assert.deepEqual(dirtyPaths(""), []);
});

test("resident instrumentation binds by apkSha256", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-qualify-candidate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (rel, value) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), JSON.stringify(value)); };
  const local = "1".repeat(64);
  // The record shape android-resident-instrumentation.ts writes.
  write("test-results/resident-instrumentation/redaction.json", { runId: "r", user: "11", test: "T", apkSha256: local, passed: true });
  const row = (result, id) => result.candidate.campaigns.find(campaign => campaign.id === id);
  assert.equal(row(recordCandidate({ qualified: true, androidBuild: { apks: [{ sha256: local }] } }, root), "resident-instrumentation").status, "passed");
  assert.equal(row(recordCandidate({ qualified: true, androidBuild: { apks: [{ sha256: "2".repeat(64) }] } }, root), "resident-instrumentation").status, "mismatched");
});
