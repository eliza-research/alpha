#!/usr/bin/env node
/**
 * Issue #658 step 1 evidence: which workflow runs executed on a forged commit, and which
 * secret / variable / environment NAMES each repository exposes (so the owner knows what
 * to rotate and can show when each one was last updated).
 *
 *   node scripts/owner/incident-ci-exposure.mjs [--repo owner/name ...] [--all] [--json]
 *
 * --all covers every repository in scripts/owner/incident-2026-10-27-iocs.json that had CI
 * runs on forged commits (default when no --repo is given). GH_BIN selects the gh binary.
 *
 * READ-ONLY: only `gh api --method GET`. Secret values are never returned by the GitHub API
 * and are never requested; this prints names and `updated_at` only. A secret whose
 * `updated_at` is before the end of the attack window is reported as NOT-ROTATED-YET.
 * Exit: 0 all reads succeeded, 2 something could not be read (usually missing admin rights).
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ghGet, ghGetAll, loadIocs, fullName, parseArgs, unreadableNote} from './gh-readonly.mjs';

/** Forged 9-hex prefixes recorded for one repository (bare name). */
export function forgedPrefixes(iocs, repo) {
  const bare = repo.split('/').pop();
  return iocs.branches.filter(row => row.repo === bare).map(row => row.forged);
}

/** Runs whose head SHA starts with one of the prefixes, de-duplicated by run id. */
export function matchRuns(runs, prefixes) {
  const seen = new Map();
  for (const run of runs) {
    const hit = prefixes.find(prefix => run.head_sha?.startsWith(prefix));
    if (hit && !seen.has(run.id)) seen.set(run.id, {
      id: run.id, forged: hit, workflow: run.name, event: run.event, branch: run.head_branch,
      conclusion: run.conclusion, created_at: run.created_at, actor: run.actor?.login ?? null,
      triggering_actor: run.triggering_actor?.login ?? null, url: run.html_url ?? null,
    });
  }
  return [...seen.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Classify a named secret/variable by whether it changed after the attack window. */
export function rotationState(updatedAt, windowEnd) {
  if (!updatedAt) return 'UNKNOWN';
  return Date.parse(updatedAt) > Date.parse(windowEnd) ? 'UPDATED-AFTER-INCIDENT' : 'NOT-ROTATED-YET';
}

// Variables are not secret; they are listed so the owner sees role ARNs, endpoints and ids that
// an exposed run could have used (for example an OIDC-assumable AWS_ROLE_ARN), not for rotation.
const names = (rows, windowEnd, kind) => rows.map(row => ({kind, name: row.name, updated_at: row.updated_at ?? null,
  state: kind.endsWith('variable') ? 'VARIABLE' : rotationState(row.updated_at, windowEnd)}));

export function auditRepository(repo, iocs, {get = ghGet} = {}) {
  const unreadable = [];
  const windowEnd = iocs.window.end;
  const readList = (label, endpoint, pick) => {
    const result = ghGetAll(endpoint, {pick, get});
    if (!result.ok) { unreadable.push(`${label}: ${unreadableNote(result)}`); return []; }
    if (result.truncated) unreadable.push(`${label}: incomplete (${result.truncated})`);
    return result.data;
  };
  const prefixes = forgedPrefixes(iocs, repo);
  // 1. Runs by exact head SHA, when GitHub still resolves the forged prefix.
  const runs = [];
  for (const prefix of prefixes) {
    const commit = get(`repos/${repo}/commits/${prefix}`);
    if (commit.ok && commit.data?.sha) runs.push(...readList(`runs for ${prefix}`, `repos/${repo}/actions/runs?head_sha=${commit.data.sha}`, page => page.workflow_runs));
  }
  // 2. Every run created in the attack window and the following day (catches unresolvable SHAs).
  const day = iocs.window.start.slice(0, 10);
  const next = new Date(Date.parse(iocs.window.end) + 2 * 86_400_000).toISOString().slice(0, 10);
  runs.push(...readList('runs in window', `repos/${repo}/actions/runs?created=${day}..${next}`, page => page.workflow_runs));
  const forgedRuns = matchRuns(runs, prefixes);

  const secrets = [
    ...names(readList('repository Actions secrets', `repos/${repo}/actions/secrets`, page => page.secrets), windowEnd, 'actions-secret'),
    ...names(readList('organization secrets visible to the repository', `repos/${repo}/actions/organization-secrets`, page => page.secrets), windowEnd, 'org-secret'),
    ...names(readList('repository Actions variables', `repos/${repo}/actions/variables`, page => page.variables), windowEnd, 'actions-variable'),
    ...names(readList('Dependabot secrets', `repos/${repo}/dependabot/secrets`, page => page.secrets), windowEnd, 'dependabot-secret'),
  ];
  const environments = readList('environments', `repos/${repo}/environments`, page => page.environments).map(env => {
    const enc = encodeURIComponent(env.name);
    return {
      name: env.name,
      protection: (env.protection_rules ?? []).map(rule => rule.type),
      secrets: names(readList(`environment ${env.name} secrets`, `repos/${repo}/environments/${enc}/secrets`, page => page.secrets), windowEnd, 'environment-secret'),
      variables: names(readList(`environment ${env.name} variables`, `repos/${repo}/environments/${enc}/variables`, page => page.variables), windowEnd, 'environment-variable'),
    };
  });
  return {repo, recordedRuns: iocs.ciRunsOnForgedCommits[repo.split('/').pop()] ?? 0, forgedRuns, secrets, environments, unreadable};
}

function print(report) {
  console.log(`\n## ${report.repo}`);
  console.log(`Runs on forged commits: found ${report.forgedRuns.length} (cleanup record: ${report.recordedRuns})`);
  for (const run of report.forgedRuns)
    console.log(`  - run ${run.id} ${run.workflow} [${run.event}, ${run.branch}, ${run.conclusion}] ${run.created_at} forged ${run.forged} actor ${run.actor}`);
  console.log('Secret / variable names (values are never read):');
  const all = [...report.secrets, ...report.environments.flatMap(env => [...env.secrets, ...env.variables].map(row => ({...row, kind: `${row.kind}:${env.name}`})))];
  for (const row of all) console.log(`  - ${row.kind} ${row.name} updated ${row.updated_at ?? '?'} ${row.state}`);
  if (!all.length) console.log('  (none readable)');
  for (const env of report.environments) console.log(`  environment ${env.name}: protection ${env.protection.join(', ') || 'none'}`);
  for (const line of report.unreadable) console.log(`UNREADABLE ${line}`);
}

function main(argv) {
  let args;
  try { args = parseArgs(argv, {flags: ['--all', '--json'], multi: ['--repo']}); }
  catch (error) { console.error(`${error.message}\nUsage: node scripts/owner/incident-ci-exposure.mjs [--repo owner/name ...] [--all] [--json]`); return 2; }
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
