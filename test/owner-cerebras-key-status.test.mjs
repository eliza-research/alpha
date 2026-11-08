// Owner prep for #671: the key-file status (lstat only, never a read), the source audit of every
// script that reads the key, and the bundle scan. Synthetic files only; no real key.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { KEY_READERS, auditSources, keyFileStatus, main, scanBundle } from "../scripts/owner/cerebras-key-status.mjs";

const root = path.resolve(import.meta.dirname, "..");
const scratch = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-key-status-")); fs.chmodSync(dir, 0o700); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };

test("status is ready only for a private, non-empty regular file, and never reads it", t => {
  const dir = scratch(t), file = path.join(dir, "cerebras-key");
  assert.deepEqual(keyFileStatus(file).problems, ["no key file (H-30 step 1)"]);
  fs.writeFileSync(file, "synthetic-not-a-key", { mode: 0o600 });
  const reads = [];
  const original = fs.readFileSync;
  fs.readFileSync = (...args) => { reads.push(args[0]); return original(...args); };
  try { assert.equal(keyFileStatus(file).ready, true); } finally { fs.readFileSync = original; }
  assert.deepEqual(reads, [], "status never reads the key file");
  fs.chmodSync(file, 0o640);
  assert.match(keyFileStatus(file).problems[0], /group or other/);
  fs.chmodSync(file, 0o400);
  assert.match(keyFileStatus(file).problems[0], /expected 0600/);
  fs.chmodSync(file, 0o600);
  fs.writeFileSync(file, "");
  assert.ok(keyFileStatus(file).problems.includes("is empty"));
  const link = path.join(dir, "linked-key");
  fs.symlinkSync(file, link);
  assert.ok(keyFileStatus(link).problems.some(line => /symbolic link/.test(line)));
});

test("the status command prints no file content", t => {
  const dir = scratch(t), file = path.join(dir, "cerebras-key");
  fs.writeFileSync(file, "synthetic-marker-value", { mode: 0o600 });
  const lines = [];
  assert.equal(main(["status", "--file", file, "--json"], { log: line => lines.push(line) }), 0);
  assert.ok(!lines.join("\n").includes("synthetic-marker-value"));
});

test("every repository script that reads the key refuses a shared file and logs no key variable", () => {
  const { findings, workflowsReferencingCerebras } = auditSources(root);
  assert.deepEqual(findings, []);
  assert.deepEqual(workflowsReferencingCerebras, [], "no workflow reads a Cerebras secret today; #671 step 2 adds one");
  assert.ok(KEY_READERS.some(reader => reader.file === "scripts/android-resident-instrumentation.mjs"));
});

test("the audit catches a log call that names the key variable, but not literal text", t => {
  const dir = scratch(t);
  fs.mkdirSync(path.join(dir, "scripts"));
  for (const reader of KEY_READERS) fs.writeFileSync(path.join(dir, reader.file), "// cerebras-key\nif (stat.mode & 0o077) throw 1; if(st.mode&0o077)x; st_mode & 0o077\nconsole.log('the key is never printed')\n");
  assert.deepEqual(auditSources(dir).findings, []);
  fs.writeFileSync(path.join(dir, "scripts/start-local-agent.mjs"), "// cerebras-key\nif (stat.mode & 0o077) throw 1;\nconst key = 1; console.log(`using ${key}`)\n");
  assert.deepEqual(auditSources(dir).findings, ["scripts/start-local-agent.mjs:3 logs key, which holds the key"]);
  fs.writeFileSync(path.join(dir, "scripts/new-launcher.mjs"), "read('.config/alphaphone/cerebras-key')");
  assert.ok(auditSources(dir).findings.some(line => /new-launcher\.mjs reads the key file but is not audited/.test(line)));
});

test("the bundle scan names files with key-shaped values, the key name or the direct host", t => {
  const dir = scratch(t);
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(path.join(dir, "assets/clean.js"), "const model='qwen-3.8-27b';");
  assert.deepEqual(scanBundle(dir), []);
  fs.writeFileSync(path.join(dir, "assets/leak.js"), `const k='csk-${"a1".repeat(16)}';fetch('https://api.cerebras.ai/v1')`);
  const findings = scanBundle(dir);
  assert.deepEqual(findings.map(row => row.rule).sort(), ["Cerebras-key-shaped value", "direct Cerebras host"]);
  assert.ok(findings.every(row => row.file === "assets/leak.js" && !JSON.stringify(row).includes("csk-")));
});
