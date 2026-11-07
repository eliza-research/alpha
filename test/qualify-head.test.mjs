import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dirtyPaths, parseQualifyArgs, readCiArchive, recordCandidate } from "../scripts/qualify-head.mjs";

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

test("--candidate-archive is accepted alone with --candidate and needs a file", () => {
  assert.equal(parseQualifyArgs(["--candidate", "--candidate-archive", "m.json"]).candidateArchive, "m.json");
  assert.equal(parseQualifyArgs(["--fresh", "--candidate-archive", "m.json"]).candidateArchive, "m.json");
  assert.throws(() => parseQualifyArgs(["--candidate-archive"]), /takes the CI archive/);
  assert.throws(() => parseQualifyArgs(["--candidate", "--candidate-archive", "m.json", "--fresh"]), /no other option/);
});

test("resident instrumentation binds by apkSha256 and resident CI binds only to a named archive", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-qualify-candidate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (rel, value) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), JSON.stringify(value)); };
  const local = "1".repeat(64), ci = "2".repeat(64), ciTest = "3".repeat(64);
  // The record shape android-resident-instrumentation.mjs writes.
  write("test-results/resident-instrumentation/redaction.json", { runId: "r", user: "11", test: "T", apkSha256: local, passed: true });
  write("test-results/resident-ci-archive/apk-manifest.json", { "launcher-debug.apk": ci, "launcher-androidTest.apk": ciTest });
  write("test-results/resident-ci-native/launcher-recovery.json", { passed: true });
  const row = (result, id) => result.candidate.campaigns.find(campaign => campaign.id === id);
  const head = () => ({ qualified: true, androidBuild: { apks: [{ sha256: local }] } });

  const plain = recordCandidate(head(), root);
  assert.equal(row(plain, "resident-instrumentation").status, "passed");
  assert.equal(row(plain, "resident-android").status, "mismatched");
  assert.equal(row(plain, "resident-android").candidateSet, "local-build");
  assert.match(row(plain, "resident-android").reason, /signed differently.*--candidate-archive/);
  assert.equal(plain.candidate.ciArchive, undefined);

  const archive = readCiArchive(path.join(root, "test-results/resident-ci-archive/apk-manifest.json"), "test-results/resident-ci-archive/apk-manifest.json");
  assert.deepEqual(archive.apkSha256, [ci], "test APKs are not the candidate");
  const bound = recordCandidate(head(), root, archive);
  assert.equal(row(bound, "resident-android").status, "passed");
  assert.equal(row(bound, "resident-android").candidateSet, "ci-archive test-results/resident-ci-archive/apk-manifest.json");
  assert.deepEqual(bound.candidate.ciArchive.apkSha256, [ci]);
  assert.deepEqual(bound.candidate.candidateApks, [local], "the local set is unchanged");
  // Other campaigns still bind to the local build only.
  assert.equal(row(bound, "resident-instrumentation").status, "passed");
  // A different archive does not admit this run's CI evidence.
  assert.equal(row(recordCandidate(head(), root, { manifest: "other", apkSha256: ["4".repeat(64)] }), "resident-android").status, "mismatched");
  assert.throws(() => readCiArchive(path.join(root, "missing.json")), /not a readable/);
});
