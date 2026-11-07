#!/usr/bin/env node
/**
 * Owner prep for #671 (docs/human-actions.md H-30): the development Cerebras key, without reading it.
 *
 *   node scripts/owner/cerebras-key-status.mjs status [--file PATH] [--json]
 *   node scripts/owner/cerebras-key-status.mjs audit
 *   node scripts/owner/cerebras-key-status.mjs scan-bundle DIR
 *
 * `status` reports whether the key file exists and is a private regular file, using lstat only: no
 * open, no read, so the value is never in this process. Default path ~/.config/alphaphone/cerebras-key
 * (or ALPHA_CEREBRAS_KEY_FILE, the override scripts/start-local-agent.mjs honours). Ready means: a
 * regular file (not a symbolic link), owned by this user, mode exactly 0600, not empty, in a
 * directory that is not group- or world-writable. Exit 0 when ready, 1 otherwise.
 *
 * `audit` re-checks, from source, every repository script that reads the key: it must refuse a
 * group- or world-readable file, and none of its console or print calls may name the variable that
 * holds the key. It also confirms no GitHub workflow references a Cerebras secret today. Exit 0
 * when clean.
 *
 * `scan-bundle` searches a built bundle directory (web-dist, an extracted APK's assets) for
 * Cerebras-key-shaped strings (csk-...), the CEREBRAS_API_KEY name and the direct api.cerebras.ai
 * host, reporting file names only. It complements scripts/audit-production-bundle.mjs, which
 * denies the manual key-entry UI text but does not scan for key-shaped values.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const USAGE = `Usage: node scripts/owner/cerebras-key-status.mjs status [--file PATH] [--json]
       node scripts/owner/cerebras-key-status.mjs audit
       node scripts/owner/cerebras-key-status.mjs scan-bundle DIR`;
export const DEFAULT_KEY_FILE = path.join(os.homedir(), ".config/alphaphone/cerebras-key");

/** File facts from lstat alone. The file is never opened. */
export function keyFileStatus(file) {
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) { return { path: file, exists: false, ready: false, problems: [error?.code === "ENOENT" ? "no key file (H-30 step 1)" : `cannot stat (${error?.code ?? "error"})`] }; }
  const problems = [];
  const mode = stat.mode & 0o777;
  if (stat.isSymbolicLink()) problems.push("is a symbolic link; some launchers follow it and some refuse it, so use a regular file");
  else if (!stat.isFile()) problems.push("is not a regular file");
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) problems.push("is not owned by this user");
  if (mode & 0o077) problems.push(`mode is ${mode.toString(8).padStart(4, "0")}: group or other can access it (chmod 600)`);
  else if (mode !== 0o600) problems.push(`mode is ${mode.toString(8).padStart(4, "0")}, expected 0600`);
  if (stat.isFile() && stat.size === 0) problems.push("is empty");
  let directory = null;
  try { directory = fs.statSync(path.dirname(file)).mode & 0o777; } catch { /* reported by the file itself */ }
  if (directory !== null && directory & 0o022) problems.push(`its directory is group- or world-writable (${directory.toString(8).padStart(4, "0")}); another user could replace the file`);
  return { path: file, exists: true, ready: !problems.length, mode: mode.toString(8).padStart(4, "0"), regularFile: stat.isFile() && !stat.isSymbolicLink(), nonEmpty: stat.size > 0, problems };
}

/** Each script that reads the key, the variable that holds it, and how it refuses a shared file. */
export const KEY_READERS = Object.freeze([
  { file: "scripts/start-local-agent.mjs", holds: ["key"], refuses: /mode & 0o077/ },
  { file: "scripts/android-resident-instrumentation.mjs", holds: ["fixture", "apiKey"], refuses: /mode & 0o077/ },
  { file: "scripts/start-combined-agent.mjs", holds: ["key"], refuses: /mode&0o077/ },
  { file: "scripts/start-local-remote.mjs", holds: ["providerKey", "settings"], refuses: /mode & 0o077/ },
  { file: "scripts/start-local-voice-agent.mjs", holds: ["env"], refuses: /mode & 0o077/ },
  { file: "scripts/start-reviewed-workflow-agent.mjs", holds: ["env"], refuses: /mode & 0o077/ },
  { file: "scripts/scan-archived-apks.py", holds: ["secret", "raw_secret", "patterns"], refuses: /st_mode & 0o077/ },
]);
const LOG_CALL = /\b(?:console\.(?:log|error|warn|info|debug)|print|sys\.std(?:out|err)\.write|process\.std(?:out|err)\.write)\s*\(/;

/** Source findings: a missing permission refusal, or a log call that names the key's variable. */
export function auditSources(root = ROOT) {
  const findings = [];
  for (const reader of KEY_READERS) {
    const file = path.join(root, reader.file);
    if (!fs.existsSync(file)) { findings.push(`${reader.file} is missing; update KEY_READERS`); continue; }
    const source = fs.readFileSync(file, "utf8");
    if (!/cerebras-key/.test(source)) findings.push(`${reader.file} no longer names the key file; update KEY_READERS`);
    if (!reader.refuses.test(source)) findings.push(`${reader.file} does not visibly refuse a group- or world-readable key file`);
    source.split("\n").forEach((line, index) => {
      // Statements on one line are split so a log call is checked on its own.
      for (const statement of line.split(";")) {
        if (!LOG_CALL.test(statement)) continue;
        // Literal text is not a variable: drop quoted strings, keeping only template ${...} parts.
        const call = statement.slice(statement.search(LOG_CALL))
          .replace(/`(?:\\.|[^`\\])*`/g, literal => (literal.match(/\$\{[^}]*\}/g) ?? []).join(" "))
          .replace(/(["'])(?:\\.|(?!\1)[^\\])*\1/g, '""');
        for (const name of reader.holds) if (new RegExp(`\\b${name}\\b`).test(call)) findings.push(`${reader.file}:${index + 1} logs ${name}, which holds the key`);
      }
    });
  }
  const unlisted = fs.readdirSync(path.join(root, "scripts")).filter(name => /\.(?:mjs|js|ts|py)$/.test(name))
    .filter(name => /cerebras-key/.test(fs.readFileSync(path.join(root, "scripts", name), "utf8")))
    .map(name => `scripts/${name}`).filter(file => !KEY_READERS.some(reader => reader.file === file));
  for (const file of unlisted) findings.push(`${file} reads the key file but is not audited; add it to KEY_READERS`);
  const workflows = path.join(root, ".github/workflows");
  const secretUses = fs.existsSync(workflows) ? fs.readdirSync(workflows).filter(name => /\.ya?ml$/.test(name))
    .filter(name => /cerebras/i.test(fs.readFileSync(path.join(workflows, name), "utf8"))) : [];
  return { findings, workflowsReferencingCerebras: secretUses };
}

export const BUNDLE_PATTERNS = Object.freeze([
  ["Cerebras-key-shaped value", /\bcsk-[A-Za-z0-9]{20,}/],
  ["CEREBRAS_API_KEY name", /CEREBRAS_API_KEY/],
  ["direct Cerebras host", /api\.cerebras\.ai/],
]);

/** Files under `dir` that match a bundle pattern, as {file, rule}. Values are never returned. */
export function scanBundle(dir) {
  const findings = [];
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && fs.statSync(full).size <= 64 << 20) {
        const text = fs.readFileSync(full).toString("latin1");
        for (const [rule, pattern] of BUNDLE_PATTERNS) if (pattern.test(text)) findings.push({ file: path.relative(dir, full), rule });
      }
    }
  };
  walk(dir);
  return findings;
}

export function main(argv, { root = ROOT, env = process.env, log = console.log, error = console.error } = {}) {
  const [command, ...rest] = argv;
  if (command === "status") {
    const index = rest.indexOf("--file");
    const file = index >= 0 ? rest[index + 1] : env.ALPHA_CEREBRAS_KEY_FILE || DEFAULT_KEY_FILE;
    const status = keyFileStatus(file);
    if (rest.includes("--json")) log(JSON.stringify(status, null, 2));
    else {
      log(`Cerebras development key file ${file}: ${status.ready ? "present, private (0600), non-empty; contents not read" : "NOT ready"}`);
      for (const line of status.problems) log(`  - ${line}`);
    }
    return status.ready ? 0 : 1;
  }
  if (command === "audit") {
    const { findings, workflowsReferencingCerebras } = auditSources(root);
    log(`Key readers audited: ${KEY_READERS.length}. ${findings.length ? `${findings.length} finding(s):` : "Each refuses a shared key file and none logs the variable that holds the key."}`);
    for (const line of findings) log(`  - ${line}`);
    log(workflowsReferencingCerebras.length ? `Workflows referencing Cerebras: ${workflowsReferencingCerebras.join(", ")}` : "No GitHub workflow references a Cerebras key or secret today.");
    return findings.length ? 1 : 0;
  }
  if (command === "scan-bundle" && rest[0]) {
    const findings = scanBundle(path.resolve(rest[0]));
    log(`Bundle ${rest[0]}: ${findings.length ? `${findings.length} finding(s)` : "no Cerebras key, key name or direct host found"}`);
    for (const finding of findings) log(`  - ${finding.file}: ${finding.rule}`);
    return findings.length ? 1 : 0;
  }
  error(USAGE);
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
