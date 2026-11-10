#!/usr/bin/env node
/**
 * Issue #658 step 1 evidence: which workflow runs executed on a forged commit or on a commit
 * built on top of one, and which
 * secret / variable / environment NAMES each repository exposes (so the owner knows what
 * to rotate and can show when each one was last updated).
 *
 *   node scripts/owner/incident-ci-exposure.ts [--repo owner/name ...] [--all] [--json]
 *
 * --all covers every repository in scripts/owner/incident-2026-10-27-iocs.json that had CI
 * runs on forged commits (default when no --repo is given). GH_BIN selects the gh binary.
 *
 * READ-ONLY: only `gh api --method GET`. Secret values are never returned by the GitHub API
 * and are never requested; this prints names and `updated_at` only. Runs are listed from the
 * attack start to `window.cleanupEnd` in the IOC file; a run counts as exposed when its head is a
 * forged commit or descends from one (GET compare/{forged}...{head}: `ahead` or `identical`).
 * A secret is UPDATED-AFTER-INCIDENT only when `updated_at` is after both the cleanup end and
 * the latest exposed run; otherwise it is NOT-ROTATED-YET.
 * Exit: 0 all reads succeeded, 2 something could not be read (usually missing admin rights).
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ghGet, ghGetAll, loadIocs, fullName, parseArgs, unreadableNote, collectRows, type IncidentIocs, type GitHubRead} from './gh-readonly.ts';

type WorkflowRun = {
  id: number; head_sha?: string; name?: string; event?: string; head_branch?: string;
  conclusion?: string; created_at: string; updated_at?: string;
  actor?: {login: string}; triggering_actor?: {login: string}; html_url?: string;
};
type NamedValue = {name: string; updated_at?: string};
type Environment = {name: string; protection_rules?: {type: string}[]};
type ReportRun = {
  id: number; forged: string; via: 'forged head'|'descendant'; workflow?: string; event?: string; branch?: string;
  conclusion?: string; created_at: string; updated_at: string; actor: string|null; triggering_actor: string|null; url: string|null;
};

/** Forged 9-hex prefixes recorded for one repository (bare name). */
export function forgedPrefixes(iocs: IncidentIocs, repo: string) {
  const bare = repo.split('/').pop();
  return iocs.branches.filter(row => row.repo === bare).map(row => row.forged);
}

/**
 * Runs whose head SHA starts with one of the prefixes, or whose head SHA `descendants` maps to the
 * forged prefix it descends from, de-duplicated by run id.
 */
export function matchRuns(runs: readonly WorkflowRun[], prefixes: readonly string[], descendants: ReadonlyMap<string,string> = new Map()) {
  const seen = new Map<number,ReportRun>();
  for (const run of runs) {
    const direct = prefixes.find(prefix => run.head_sha?.startsWith(prefix));
    const hit = direct ?? (run.head_sha ? descendants.get(run.head_sha) : undefined);
    if (hit && !seen.has(run.id)) seen.set(run.id, {
      id: run.id, forged: hit, via: direct ? 'forged head' : 'descendant', workflow: run.name, event: run.event, branch: run.head_branch,
      conclusion: run.conclusion, created_at: run.created_at, updated_at: run.updated_at ?? run.created_at, actor: run.actor?.login ?? null,
      triggering_actor: run.triggering_actor?.login ?? null, url: run.html_url ?? null,
    });
  }
  return [...seen.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Classify a named secret/variable by whether it changed after the exposure cutoff. */
export function rotationState(updatedAt: string | null | undefined, windowEnd: string) {
  if (!updatedAt) return 'UNKNOWN';
  return Date.parse(updatedAt) > Date.parse(windowEnd) ? 'UPDATED-AFTER-INCIDENT' : 'NOT-ROTATED-YET';
}

// Variables are not secret; they are listed so the owner sees role ARNs, endpoints and ids that
// an exposed run could have used (for example an OIDC-assumable AWS_ROLE_ARN), not for rotation.
const names = (rows: readonly NamedValue[], windowEnd: string, kind: string) => rows.map(row => ({kind, name: row.name, updated_at: row.updated_at ?? null,
  state: kind.endsWith('variable') ? 'VARIABLE' : rotationState(row.updated_at, windowEnd)}));

/** End of the exposure: the later of the cleanup end and the last update of an exposed run. */
export function exposureCutoff(cleanupEnd: string, forgedRuns: readonly Pick<ReportRun,'updated_at'>[]) {
  return [cleanupEnd, ...forgedRuns.map(run => run.updated_at)].filter(Boolean)
    .reduce((latest, time) => Date.parse(time) > Date.parse(latest) ? time : latest);
}

export function auditRepository(repo: string, iocs: IncidentIocs, {get = ghGet}: {get?: GitHubRead} = {}) {
  const unreadable: string[] = [];
  const cleanupEnd = iocs.window.cleanupEnd ?? iocs.window.end;
  const readList = <Row, Key extends string>(label: string, endpoint: string, field: Key) =>
    collectRows(ghGetAll<Row, Partial<Record<Key,Row[]>>>(endpoint, {pick: page => page[field], get}), label, unreadable) ?? [];
  const prefixes = forgedPrefixes(iocs, repo);
  // 1. Runs by exact head SHA, when GitHub still resolves the forged prefix.
  const runs: WorkflowRun[] = [];
  const resolved = new Map<string,string>();
  for (const prefix of prefixes) {
    const commit = get<{sha?: string}>(`repos/${repo}/commits/${prefix}`);
    if (commit.ok && commit.data?.sha) {
      resolved.set(prefix, commit.data.sha);
      runs.push(...readList<WorkflowRun,'workflow_runs'>(`runs for ${prefix}`, `repos/${repo}/actions/runs?head_sha=${commit.data.sha}`, 'workflow_runs'));
    } else if (!commit.ok && ![404, 422].includes(commit.status)) unreadable.push(`forged commit ${prefix}: ${unreadableNote(commit)}`);
  }
  // 2. Every run created from the attack start to the cleanup end (catches unresolvable SHAs and descendants).
  const day = iocs.window.start.slice(0, 10);
  const last = cleanupEnd.slice(0, 10);
  const windowRuns = readList<WorkflowRun,'workflow_runs'>('runs in window', `repos/${repo}/actions/runs?created=${day}..${last}`, 'workflow_runs');
  runs.push(...windowRuns);
  // 3. Window runs whose head descends from a resolvable forged commit: one compare per head and forged commit.
  const descendants = new Map<string,string>();
  let compares = 0;
  const heads = [...new Set(windowRuns.map(run => run.head_sha).filter((sha): sha is string => !!sha && !prefixes.some(prefix => sha.startsWith(prefix))))];
  for (const head of heads) for (const [prefix, sha] of resolved) {
    if (descendants.has(head)) break;
    compares++;
    const result = get<{status?: string}>(`repos/${repo}/compare/${sha}...${head}?per_page=1`);
    if (!result.ok) unreadable.push(`compare ${prefix}...${head.slice(0, 9)}: ${unreadableNote(result)}`);
    else if (['ahead', 'identical'].includes(result.data?.status ?? '')) descendants.set(head, prefix);
  }
  const forgedRuns = matchRuns(runs, prefixes, descendants);
  const windowEnd = exposureCutoff(cleanupEnd, forgedRuns);

  const secrets = [
    ...names(readList<NamedValue,'secrets'>('repository Actions secrets', `repos/${repo}/actions/secrets`, 'secrets'), windowEnd, 'actions-secret'),
    ...names(readList<NamedValue,'secrets'>('organization secrets visible to the repository', `repos/${repo}/actions/organization-secrets`, 'secrets'), windowEnd, 'org-secret'),
    ...names(readList<NamedValue,'variables'>('repository Actions variables', `repos/${repo}/actions/variables`, 'variables'), windowEnd, 'actions-variable'),
    ...names(readList<NamedValue,'secrets'>('Dependabot secrets', `repos/${repo}/dependabot/secrets`, 'secrets'), windowEnd, 'dependabot-secret'),
  ];
  const environments = readList<Environment,'environments'>('environments', `repos/${repo}/environments`, 'environments').map(env => {
    const enc = encodeURIComponent(env.name);
    return {
      name: env.name,
      protection: (env.protection_rules ?? []).map(rule => rule.type),
      secrets: names(readList<NamedValue,'secrets'>(`environment ${env.name} secrets`, `repos/${repo}/environments/${enc}/secrets`, 'secrets'), windowEnd, 'environment-secret'),
      variables: names(readList<NamedValue,'variables'>(`environment ${env.name} variables`, `repos/${repo}/environments/${enc}/variables`, 'variables'), windowEnd, 'environment-variable'),
    };
  });
  return {repo, recordedRuns: iocs.ciRunsOnForgedCommits[repo.split('/').at(-1) ?? repo] ?? 0, forgedRuns, compares, rotationCutoff: windowEnd, secrets, environments, unreadable};
}

function print(report: ReturnType<typeof auditRepository>) {
  console.log(`\n## ${report.repo}`);
  console.log(`Runs on or descending from forged commits: found ${report.forgedRuns.length} (cleanup record: ${report.recordedRuns} on forged heads; ${report.compares} ancestry compares)`);
  for (const run of report.forgedRuns)
    console.log(`  - run ${run.id} ${run.workflow} [${run.event}, ${run.branch}, ${run.conclusion}] ${run.created_at} ${run.via} ${run.forged} actor ${run.actor}`);
  console.log(`Secret / variable names (values are never read); rotated means updated after ${report.rotationCutoff}:`);
  const all = [...report.secrets, ...report.environments.flatMap(env => [...env.secrets, ...env.variables].map(row => ({...row, kind: `${row.kind}:${env.name}`})))];
  for (const row of all) console.log(`  - ${row.kind} ${row.name} updated ${row.updated_at ?? '?'} ${row.state}`);
  if (!all.length) console.log('  (none readable)');
  for (const env of report.environments) console.log(`  environment ${env.name}: protection ${env.protection.join(', ') || 'none'}`);
  for (const line of report.unreadable) console.log(`UNREADABLE ${line}`);
}

function main(argv: readonly string[]) {
  let args;
  try { args = parseArgs(argv, {flags: ['--all', '--json'], multi: ['--repo']}); }
  catch (error) { console.error(`${error instanceof Error ? error.message : String(error)}\nUsage: node scripts/owner/incident-ci-exposure.ts [--repo owner/name ...] [--all] [--json]`); return 2; }
  const iocs = loadIocs();
  const repos = args.repo?.length && !args.all ? args.repo : Object.keys(iocs.ciRunsOnForgedCommits).map(repo => fullName(iocs, repo));
  const reports = repos.map(repo => auditRepository(repo, iocs));
  if (args.json) console.log(JSON.stringify({generatedAt: new Date().toISOString(), window: iocs.window, reports}, null, 2));
  else {
    console.log('Read-only CI exposure report (nothing was changed; no secret value was read).');
    reports.forEach(print);
  }
  return reports.some(report => report.unreadable.length) ? 2 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
