#!/usr/bin/env node
/**
 * Issue #658: scan every current branch and tag of a remote for the 2026-10-27 forged-commit
 * markers WITHOUT checking anything out.
 *
 *   node scripts/owner/forged-branch-scan.mjs [--git-dir path] [--remote origin] [--repo alphaphone] [--json]
 *
 * Reads the current heads with `git ls-remote` (a read of the remote; nothing is pushed), then for
 * each head whose objects exist locally (run `git fetch <remote>` first) it uses only `git
 * merge-base --is-ancestor`, `git ls-tree` and `git show <sha>:<path>` (object reads; no work
 * tree, no hooks, no npm). Checks:
 *   - ancestry: the head reaches a forged commit recorded for --repo in the IOC file;
 *   - paths: root `init`, `.env`, `.vscode/tasks.json`, `.vscode/settings.json`, any
 *     `reminders/public/fonts/` directory and `.orc` files;
 *   - package.json scripts that run `node init`;
 *   - content patterns (folderOpen tasks, `atob(process.env.X)` loaders, `eval(proxyInfo)`) in
 *     package.json, .vscode/tasks.json and the root *.config.{ts,js,mjs,cjs} files.
 * Exit: 0 clean, 1 at least one marker, 2 a head could not be scanned (object missing).
 */
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadIocs, parseArgs, ROOT} from './gh-readonly.mjs';

const git = (gitDir, args, {allowFail = false} = {}) => {
  const result = spawnSync('git', ['-C', gitDir, ...args], {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});
  if (result.status !== 0 && !allowFail) throw new Error(`git ${args.join(' ')}: ${result.stderr.trim()}`);
  return result;
};

export function parseLsRemote(text) {
  return text.split('\n').filter(Boolean).map(line => line.split('\t')).filter(([, ref]) => ref && !ref.endsWith('^{}'))
    .map(([sha, ref]) => ({sha, ref}));
}

/** Path markers in a `git ls-tree -r --name-only` listing. */
export function pathMarkers(files, markers) {
  const exact = new Set(markers.paths);
  const patterns = markers.pathPatterns.map(pattern => new RegExp(pattern));
  return files.filter(file => exact.has(file) || patterns.some(pattern => pattern.test(file)));
}

/** package.json script names whose command runs the `init` payload. */
export function initScripts(packageJsonText, markers) {
  let scripts;
  try { scripts = JSON.parse(packageJsonText).scripts ?? {}; } catch { return ['(package.json does not parse)']; }
  const pattern = new RegExp(markers.packageScriptPattern);
  return Object.entries(scripts).filter(([, command]) => typeof command === 'string' && pattern.test(command)).map(([name]) => name);
}

export function contentMarkers(text, markers) {
  return markers.contentPatterns.filter(pattern => new RegExp(pattern).test(text));
}

/** Files whose content is checked: small, fixed set (never the whole tree). */
export function contentTargets(files) {
  return files.filter(file => file === 'package.json' || file === '.vscode/tasks.json' || /^[^/]+\.config\.(ts|js|mjs|cjs)$/.test(file));
}

export function scanHead(gitDir, head, forgedShas, markers) {
  const exists = git(gitDir, ['cat-file', '-e', `${head.sha}^{commit}`], {allowFail: true}).status === 0;
  if (!exists) return {...head, scanned: false, findings: [], note: head.ref.startsWith('refs/tags/') ? 'tag object not fetched' : 'commit not fetched locally'};
  const findings = [];
  for (const forged of forgedShas)
    if (git(gitDir, ['merge-base', '--is-ancestor', forged, head.sha], {allowFail: true}).status === 0) findings.push(`reaches forged commit ${forged.slice(0, 9)}`);
  const files = git(gitDir, ['ls-tree', '-r', '--name-only', head.sha]).stdout.split('\n').filter(Boolean);
  for (const file of pathMarkers(files, markers)) findings.push(`marker path ${file}`);
  for (const file of contentTargets(files)) {
    const text = git(gitDir, ['show', `${head.sha}:${file}`], {allowFail: true}).stdout ?? '';
    if (file === 'package.json') for (const name of initScripts(text, markers)) findings.push(`package.json script "${name}" runs init`);
    for (const pattern of contentMarkers(text, markers)) findings.push(`${file} matches /${pattern}/`);
  }
  return {...head, scanned: true, findings};
}

function main(argv) {
  let args;
  try { args = parseArgs(argv, {flags: ['--json'], options: ['--git-dir', '--remote', '--repo']}); }
  catch (error) { console.error(`${error.message}\nUsage: node scripts/owner/forged-branch-scan.mjs [--git-dir path] [--remote origin] [--repo alphaphone] [--json]`); return 2; }
  const gitDir = path.resolve(args['git-dir'] ?? ROOT);
  const remote = args.remote ?? 'origin';
  const iocs = loadIocs();
  const repo = args.repo ?? 'alphaphone';
  const prefixes = iocs.branches.filter(row => row.repo === repo).map(row => row.forged);
  // Resolve prefixes to full SHAs only when the objects are present locally (they are data; never checked out).
  const forgedShas = prefixes.map(prefix => git(gitDir, ['rev-parse', '-q', '--verify', `${prefix}^{commit}`], {allowFail: true}).stdout.trim()).filter(Boolean);
  const heads = parseLsRemote(execFileSync('git', ['-C', gitDir, 'ls-remote', '--heads', '--tags', remote], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}));
  const results = heads.map(head => scanHead(gitDir, head, forgedShas, iocs.markers));
  const flagged = results.filter(row => row.findings.length);
  const unscanned = results.filter(row => !row.scanned);
  const summary = {remote, url: git(gitDir, ['remote', 'get-url', remote]).stdout.trim(), repo, forgedPrefixes: prefixes, forgedResolvedLocally: forgedShas.length, heads: results.length, scanned: results.length - unscanned.length, flagged: flagged.length, unscanned: unscanned.length};
  if (args.json) console.log(JSON.stringify({summary, flagged, unscanned}, null, 2));
  else {
    console.log(`Read-only scan of ${summary.url} (${remote}); nothing was checked out.`);
    console.log(`Forged prefixes for ${repo}: ${prefixes.join(', ') || '(none)'}; resolved locally for ancestry: ${forgedShas.length}/${prefixes.length}`);
    console.log(`Heads: ${summary.heads}, scanned ${summary.scanned}, flagged ${summary.flagged}, not scanned ${summary.unscanned}`);
    for (const row of flagged) console.log(`FLAG ${row.ref} ${row.sha.slice(0, 12)}: ${row.findings.join('; ')}`);
    for (const row of unscanned) console.log(`SKIP ${row.ref} ${row.sha.slice(0, 12)}: ${row.note}`);
    if (forgedShas.length < prefixes.length) console.log('NOTE Some forged commits are not in the local object store, so ancestry was checked only for the ones present; path and content markers were still checked.');
  }
  return flagged.length ? 1 : unscanned.some(row => row.ref.startsWith('refs/heads/')) ? 2 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
