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
import {ghGet, ghGetAll, loadIocs, fullName, parseArgs, unreadableNote} from './gh-readonly.ts';

/** Forged 9-hex prefixes recorded for one repository (bare name). */
export function forgedPrefixes(iocs: any, repo: any) {
  const bare = repo.split('/').pop();
  return iocs.branches.filter((row: any) => row.repo === bare).map((row: any) => row.forged);
}

/**
 * Runs whose head SHA starts with one of the prefixes, or whose head SHA `descendants` maps to the
 * forged prefix it descends from, de-duplicated by run id.
 */
export function matchRuns(runs: any, prefixes: any, descendants: any = new Map()) {
  const seen = new Map();
  for (const run of runs) {
    const direct = prefixes.find((prefix: any) => run.head_sha?.startsWith(prefix));
    const hit = direct ?? descendants.get(run.head_sha);
    if (hit && !seen.has(run.id)) seen.set(run.id, {
      id: run.id, forged: hit, via: direct ? 'forged head' : 'descendant', workflow: run.name, event: run.event, branch: run.head_branch,
      conclusion: run.conclusion, created_at: run.created_at, updated_at: run.updated_at ?? run.created_at, actor: run.actor?.login ?? null,
      triggering_actor: run.triggering_actor?.login ?? null, url: run.html_url ?? null,
    });
  }
  return [...seen.values()].sort((a: any, b: any) => a.created_at.localeCompare(b.created_at));
}

/** Classify a named secret/variable by whether it changed after the exposure cutoff. */
export function rotationState(updatedAt: any, windowEnd: any) {
  if (!updatedAt) return 'UNKNOWN';
  return Date.parse(updatedAt) > Date.parse(windowEnd) ? 'UPDATED-AFTER-INCIDENT' : 'NOT-ROTATED-YET';
}

// Variables are not secret; they are listed so the owner sees role ARNs, endpoints and ids that
// an exposed run could have used (for example an OIDC-assumable AWS_ROLE_ARN), not for rotation.
const names = (rows: any, windowEnd: any, kind: any) => rows.map((row: any) => ({kind, name: row.name, updated_at: row.updated_at ?? null,
  state: kind.endsWith('variable') ? 'VARIABLE' : rotationState(row.updated_at, windowEnd)}));

/** End of the exposure: the later of the cleanup end and the last update of an exposed run. */
export function exposureCutoff(cleanupEnd: any, forgedRuns: any) {
  return [cleanupEnd, ...forgedRuns.map((run: any) => run.updated_at)].filter(Boolean)
    .reduce((latest: any, time: any) => Date.parse(time) > Date.parse(latest) ? time : latest);
}

export function auditRepository(repo: any, iocs: any, {get = ghGet}: any = {}) {
  const unreadable: any[] = [];
  const cleanupEnd = iocs.window.cleanupEnd ?? iocs.window.end;
  const readList = (label: any, endpoint: any, pick: any) => {
    const result = ghGetAll(endpoint, {pick, get});
    if (!result.ok) { unreadable.push(`${label}: ${unreadableNote(result)}`); return []; }
    if (result.truncated) unreadable.push(`${label}: incomplete (${result.truncated})`);
    return result.data;
  };
  const prefixes = forgedPrefixes(iocs, repo);
  // 1. Runs by exact head SHA, when GitHub still resolves the forged prefix.
  const runs: any[] = [];
  const resolved = new Map();
  for (const prefix of prefixes) {
    const commit = get(`repos/${repo}/commits/${prefix}`);
    if (commit.ok && commit.data?.sha) {
      resolved.set(prefix, commit.data.sha);
      runs.push(...readList(`runs for ${prefix}`, `repos/${repo}/actions/runs?head_sha=${commit.data.sha}`, (page: any) => page.workflow_runs));
    } else if (!commit.ok && ![404, 422].includes(commit.status)) unreadable.push(`forged commit ${prefix}: ${unreadableNote(commit)}`);
  }
  // 2. Every run created from the attack start to the cleanup end (catches unresolvable SHAs and descendants).
  const day = iocs.window.start.slice(0, 10);
  const last = cleanupEnd.slice(0, 10);
  const windowRuns = readList('runs in window', `repos/${repo}/actions/runs?created=${day}..${last}`, (page: any) => page.workflow_runs);
  runs.push(...windowRuns);
  // 3. Window runs whose head descends from a resolvable forged commit: one compare per head and forged commit.
  const descendants = new Map();
  let compares = 0;
  const heads = [...new Set<string>(windowRuns.map((run: any) => run.head_sha).filter((sha: any) => sha && !prefixes.some((prefix: any) => sha.startsWith(prefix))))];
  for (const head of heads) for (const [prefix, sha] of resolved) {
    if (descendants.has(head)) break;
    compares++;
    const result = get(`repos/${repo}/compare/${sha}...${head}?per_page=1`);
    if (!result.ok) unreadable.push(`compare ${prefix}...${head.slice(0, 9)}: ${unreadableNote(result)}`);
    else if (['ahead', 'identical'].includes(result.data?.status)) descendants.set(head, prefix);
  }
  const forgedRuns = matchRuns(runs, prefixes, descendants);
  const windowEnd = exposureCutoff(cleanupEnd, forgedRuns);

  const secrets = [
    ...names(readList('repository Actions secrets', `repos/${repo}/actions/secrets`, (page: any) => page.secrets), windowEnd, 'actions-secret'),
    ...names(readList('organization secrets visible to the repository', `repos/${repo}/actions/organization-secrets`, (page: any) => page.secrets), windowEnd, 'org-secret'),
    ...names(readList('repository Actions variables', `repos/${repo}/actions/variables`, (page: any) => page.variables), windowEnd, 'actions-variable'),
    ...names(readList('Dependabot secrets', `repos/${repo}/dependabot/secrets`, (page: any) => page.secrets), windowEnd, 'dependabot-secret'),
  ];
  const environments = readList('environments', `repos/${repo}/environments`, (page: any) => page.environments).map((env: any) => {
    const enc = encodeURIComponent(env.name);
    return {
      name: env.name,
      protection: (env.protection_rules ?? []).map((rule: any) => rule.type),
      secrets: names(readList(`environment ${env.name} secrets`, `repos/${repo}/environments/${enc}/secrets`, (page: any) => page.secrets), windowEnd, 'environment-secret'),
      variables: names(readList(`environment ${env.name} variables`, `repos/${repo}/environments/${enc}/variables`, (page: any) => page.variables), windowEnd, 'environment-variable'),
    };
  });
  return {repo, recordedRuns: iocs.ciRunsOnForgedCommits[repo.split('/').pop()] ?? 0, forgedRuns, compares, rotationCutoff: windowEnd, secrets, environments, unreadable};
}

function print(report: any) {
  console.log(`\n## ${report.repo}`);
  console.log(`Runs on or descending from forged commits: found ${report.forgedRuns.length} (cleanup record: ${report.recordedRuns} on forged heads; ${report.compares} ancestry compares)`);
  for (const run of report.forgedRuns)
    console.log(`  - run ${run.id} ${run.workflow} [${run.event}, ${run.branch}, ${run.conclusion}] ${run.created_at} ${run.via} ${run.forged} actor ${run.actor}`);
  console.log(`Secret / variable names (values are never read); rotated means updated after ${report.rotationCutoff}:`);
  const all = [...report.secrets, ...report.environments.flatMap((env: any) => [...env.secrets, ...env.variables].map((row: any) => ({...row, kind: `${row.kind}:${env.name}`})))];
  for (const row of all) console.log(`  - ${row.kind} ${row.name} updated ${row.updated_at ?? '?'} ${row.state}`);
  if (!all.length) console.log('  (none readable)');
  for (const env of report.environments) console.log(`  environment ${env.name}: protection ${env.protection.join(', ') || 'none'}`);
  for (const line of report.unreadable) console.log(`UNREADABLE ${line}`);
}

function main(argv: any) {
  let args;
  try { args = parseArgs(argv, {flags: ['--all', '--json'], multi: ['--repo']}); }
  catch (error: any) { console.error(`${error.message}\nUsage: node scripts/owner/incident-ci-exposure.ts [--repo owner/name ...] [--all] [--json]`); return 2; }
  const iocs = loadIocs();
  const repos = args.repo?.length && !args.all ? args.repo : Object.keys(iocs.ciRunsOnForgedCommits).map((repo: any) => fullName(iocs, repo));
  const reports = repos.map((repo: any) => auditRepository(repo, iocs));
  if (args.json) console.log(JSON.stringify({generatedAt: new Date().toISOString(), window: iocs.window, reports}, null, 2));
  else {
    console.log('Read-only CI exposure report (nothing was changed; no secret value was read).');
    reports.forEach(print);
  }
  return reports.some((report: any) => report.unreadable.length) ? 2 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
