#!/usr/bin/env node
/**
 * Read-only review aid for a merge commit (issue #659: post-merge review of #657, merge 91c83b3c).
 *
 *   node scripts/owner/merge-review.ts [MERGE_SHA] [--json]
 *
 * Reads only local git objects: it never fetches, checks out, runs package scripts or contacts a
 * service. The forged SHAs and marker patterns come from scripts/owner/incident-2026-10-27-iocs.json,
 * plus a few broader local shapes. It reports, for MERGE^1..MERGE:
 *  - every package.json script that was added, removed or changed;
 *  - every binary file the diff adds, deletes or modifies (git numstat "-");
 *  - the 2026-10-27 forged-commit markers: reachability of each forged SHA from the merge, and
 *    changed paths or added lines that match the attack's payload shapes;
 *  - whether android/consumer-host.json at the merge names every Gradle module and resident
 *    helper the issue lists.
 * The result is source review data only. It is not an APK, emulator, image or device result.
 */
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadIocs, type IncidentIocs} from './gh-readonly.ts';
import {isRecord} from './input.ts';

/** Broader path shapes than the IOC file records: init script, .env or VS Code files in any directory. */
export const LOCAL_PATH_PATTERNS = Object.freeze([
 {name: 'init script', pattern: /(^|\/)init(\.[cm]?js)?$/},
 {name: '.env file', pattern: /(^|\/)\.env(\.|$)/},
 {name: 'VS Code tasks', pattern: /(^|\/)\.vscode\//},
]);

/** Broader added-line shapes than the IOC file records: a remote eval, a folderOpen task, an npm hook into init. */
export const LOCAL_LINE_PATTERNS = Object.freeze([
 {name: 'folderOpen task', pattern: /folderOpen/},
 {name: 'eval of fetched code', pattern: /\beval\s*\(\s*(await\s+)?(fetch|\(await|res|response|body|data)\b/},
 {name: 'new Function of fetched code', pattern: /new\s+Function\s*\(\s*(await\s+)?(fetch|res|response|body|data)\b/},
 {name: 'npm hook into init', pattern: /"(predev|prebuild|postinstall|preinstall|dev|build)"\s*:\s*"[^"]*node\s+(\.\/)?init\b/},
]);

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Forged SHA prefixes and marker patterns for one repository: the IOC file's first, then the local ones. */
export function markerPatterns(iocs: IncidentIocs, repo = 'alphaphone') {
 const markers = iocs.markers;
 return {
  forged: [...new Set(iocs.branches.filter(row => row.repo === repo).map(row => row.forged))],
  paths: [
   ...markers.paths.map(file => ({name: `IOC path ${file}`, pattern: new RegExp(`^${escapeRegExp(file)}$`)})),
   ...markers.pathPatterns.map(source => ({name: `IOC path /${source}/`, pattern: new RegExp(source)})),
   ...LOCAL_PATH_PATTERNS,
  ],
  lines: [...markers.contentPatterns.map(source => ({name: `IOC /${source}/`, pattern: new RegExp(source)})), ...LOCAL_LINE_PATTERNS],
 };
}

export const MARKERS = markerPatterns(loadIocs());

/** Forged commits from the 2026-10-27 compromise, as the IOC file records them for this repository. */
export const FORGED_COMMITS = Object.freeze(MARKERS.forged);

/** Modules and helpers #659 names: #636, #641, #650 and the #642 browser-surface helpers. */
export const EXPECTED_MODULES = Object.freeze(['eliza-cloud-auth', 'eliza-messages', 'eliza-phone']);
export const EXPECTED_HELPER_SUFFIXES = Object.freeze(['NativeRuntimeEmbeddings.java']);
export const EXPECTED_BROWSER_SURFACE_HELPERS_AT_LEAST = 16;

/** Script differences between two package.json texts (either may be null when the file is absent). */
export function diffScripts(beforeText: string | null, afterText: string | null) {
 const scripts = (text: string | null): Record<string, unknown> => {
  if (!text) return {};
  const parsed: unknown = JSON.parse(text);
  return isRecord(parsed) && isRecord(parsed.scripts) ? parsed.scripts : {};
 };
 const before = scripts(beforeText), after = scripts(afterText);
 const added = [], removed = [], changed = [];
 for (const [name, command] of Object.entries(after)) {
  if (!Object.hasOwn(before, name)) added.push({name, command});
  else if (before[name] !== command) changed.push({name, before: before[name], after: command});
 }
 for (const [name, command] of Object.entries(before)) if (!Object.hasOwn(after, name)) removed.push({name, command});
 return {added, removed, changed};
}

/** Binary entries from `git diff --numstat` output joined with `--name-status` output. */
export function binaryChanges(numstat: string, nameStatus: string) {
 const status = new Map<string, string>();
 for (const line of nameStatus.split('\n').filter(Boolean)) {
  const [code, ...paths] = line.split('\t');
  status.set(paths[paths.length - 1], code[0]);
 }
 return numstat.split('\n').filter(Boolean).map(line => line.split('\t')).filter(([added, deleted]) => added === '-' && deleted === '-')
  .map(([, , file]) => ({path: file, status: status.get(file) ?? '?'}));
}

/** Forged-marker findings among changed paths and added diff lines: the first matching pattern for each. */
interface AddedLine {
 file: string;
 line: string;
}

interface MarkerFinding {
 kind: 'path' | 'line';
 name: string;
 path: string;
 line?: string;
}

export function forgedMarkers(changedPaths: readonly string[], addedLines: readonly AddedLine[], markers = MARKERS) {
 const findings: MarkerFinding[] = [];
 for (const file of changedPaths) {
  const hit = markers.paths.find(({pattern}) => pattern.test(file));
  if (hit) findings.push({kind: 'path', name: hit.name, path: file});
 }
 for (const {file, line} of addedLines) {
  const hit = markers.lines.find(({pattern}) => pattern.test(line));
  if (hit) findings.push({kind: 'line', name: hit.name, path: file, line: line.slice(0, 200)});
 }
 return findings;
}

/** Added lines from a unified diff, with the file each belongs to. */
export function addedLinesFromDiff(diff: string) {
 const lines = [];
 let file: string | null = null;
 for (const line of diff.split('\n')) {
  if (line.startsWith('+++ ')) file = line.startsWith('+++ b/') ? line.slice(6) : null;
  else if (file && line.startsWith('+') && !line.startsWith('+++')) lines.push({file, line: line.slice(1)});
 }
 return lines;
}

/** Which issue-named modules and helpers a consumer-host descriptor lacks. */
export function descriptorCoverage(descriptorText: string) {
 const parsed: unknown = JSON.parse(descriptorText);
 const descriptor = isRecord(parsed) ? parsed : {};
 const profile = isRecord(descriptor.profile) ? descriptor.profile : {};
 const residentHost = isRecord(descriptor.residentHost) ? descriptor.residentHost : {};
 const modules = Array.isArray(profile.modules) ? profile.modules.map(module => isRecord(module) ? module.name : undefined) : [];
 const helpers = Array.isArray(residentHost.helpers) ? residentHost.helpers.filter(helper => typeof helper === 'string') : [];
 const browserSurface = helpers.filter(helper => helper.includes('/plugin-native-browser-surface/'));
 return {
  modules: modules.length,
  missingModules: EXPECTED_MODULES.filter(name => !modules.includes(name)),
  missingHelpers: EXPECTED_HELPER_SUFFIXES.filter(suffix => !helpers.some(helper => helper.endsWith('/' + suffix))),
  browserSurfaceHelpers: browserSurface.length,
  browserSurfaceShort: browserSurface.length < EXPECTED_BROWSER_SURFACE_HELPERS_AT_LEAST,
 };
}

function git(root: string, args: readonly string[]): string;
function git(root: string, args: readonly string[], options: {allowFailure: true}): string | null;
function git(root: string, args: readonly string[], {allowFailure = false} = {}): string | null {
 try {
  return execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
 } catch (error) {
  if (allowFailure) return null;
  throw error;
 }
}

/** The full read-only review of one merge commit in the checkout at `root`. */
export function reviewMerge(root: string, merge: string) {
 const sha = git(root, ['rev-parse', '--verify', `${merge}^{commit}`]).trim();
 const base = `${sha}^1`;
 const nameStatus = git(root, ['diff', '--name-status', base, sha]);
 const changedPaths = nameStatus.split('\n').filter(Boolean).flatMap(line => line.split('\t').slice(1));
 const packageFiles = [...new Set(changedPaths.filter(file => path.basename(file) === 'package.json'))];
 const scripts = packageFiles.map(file => ({file, ...diffScripts(git(root, ['show', `${base}:${file}`], {allowFailure: true}), git(root, ['show', `${sha}:${file}`], {allowFailure: true}))}));
 const binaries = binaryChanges(git(root, ['diff', '--numstat', base, sha]), nameStatus);
 const markers = forgedMarkers(changedPaths, addedLinesFromDiff(git(root, ['diff', '--no-color', '-U0', base, sha])));
 const forged = FORGED_COMMITS.map(commit => {
  const known = git(root, ['cat-file', '-e', `${commit}^{commit}`], {allowFailure: true}) !== null;
  const reachable = known && git(root, ['merge-base', '--is-ancestor', commit, sha], {allowFailure: true}) !== null;
  return {commit, known, reachable};
 });
 const descriptorText = git(root, ['show', `${sha}:android/consumer-host.json`], {allowFailure: true});
 return {
  merge: sha,
  parents: git(root, ['log', '-1', '--format=%P', sha]).trim().split(' '),
  files: changedPaths.length,
  scripts,
  binaries,
  forged,
  markers,
  descriptor: descriptorText ? descriptorCoverage(descriptorText) : null,
 };
}

function print(result: ReturnType<typeof reviewMerge>) {
 const out = [];
 out.push(`Merge ${result.merge} (parents ${result.parents.join(', ')}), ${result.files} changed paths. Source review only.`);
 for (const entry of result.scripts) {
  out.push(`package scripts in ${entry.file}: +${entry.added.length} -${entry.removed.length} ~${entry.changed.length}`);
  for (const item of entry.added) out.push(`  added   ${item.name}: ${item.command}`);
  for (const item of entry.removed) out.push(`  removed ${item.name}: ${item.command}`);
  for (const item of entry.changed) out.push(`  changed ${item.name}: ${item.before} -> ${item.after}`);
 }
 out.push(`binary files: ${result.binaries.length}`);
 for (const item of result.binaries) out.push(`  ${item.status} ${item.path}`);
 out.push(`forged commits reachable: ${result.forged.filter(item => item.reachable).map(item => item.commit).join(', ') || 'none'}`);
 const unknown = result.forged.filter(item => !item.known).map(item => item.commit);
 if (unknown.length) out.push(`  not present locally (reachability not checked): ${unknown.join(', ')}`);
 out.push(`forged path/line markers: ${result.markers.length}`);
 for (const item of result.markers) out.push(`  ${item.kind} ${item.name}: ${item.path}${item.line ? ` :: ${item.line}` : ''}`);
 if (result.descriptor) {
  const d = result.descriptor;
  out.push(`consumer-host.json: ${d.modules} modules; missing modules: ${d.missingModules.join(', ') || 'none'}; missing helpers: ${d.missingHelpers.join(', ') || 'none'}; browser-surface helpers: ${d.browserSurfaceHelpers}${d.browserSurfaceShort ? ' (fewer than the issue names)' : ''}`);
 } else out.push('consumer-host.json: absent at the merge');
 return out.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const args = process.argv.slice(2);
 const json = args.includes('--json');
 const positional = args.filter(arg => !arg.startsWith('--'));
 if (positional.length > 1 || args.some(arg => arg.startsWith('--') && arg !== '--json')) {
  console.error('Usage: node scripts/owner/merge-review.ts [MERGE_SHA] [--json]');
  process.exit(2);
 }
 const root = fileURLToPath(new URL('../../', import.meta.url));
 const result = reviewMerge(root, positional[0] ?? '91c83b3c');
 console.log(json ? JSON.stringify(result, null, 1) : print(result));
}
