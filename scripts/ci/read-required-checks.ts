#!/usr/bin/env node
/**
 * Read back the rules GitHub actually enforces on the default branch and diff them against the
 * intended required checks in scripts/ci/required-checks-ruleset.json.
 *
 *   node scripts/ci/read-required-checks.ts [--repo owner/name] [--branch main] [--json]
 *
 * READ-ONLY. Every request is `gh api --method GET`; this never creates, edits or deletes a
 * ruleset, branch protection or any other setting. Installing the ruleset is the repository
 * owner's decision; when something is missing this prints the command for the owner to run.
 * Exit status: 0 enforced as intended, 1 differences found, 2 the state could not be read.
 *
 * A matching read-back is configuration evidence only. MVP-46 also needs a controlled pull
 * request showing that a missing or failing check blocks the merge.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const INTENDED_FILE = 'scripts/ci/required-checks-ruleset.json';

/**
 * The single way this script talks to GitHub: an explicit GET. GH_BIN selects the gh binary for
 * hosts where the PATH shim hangs; a stalled gh is killed so the read is reported as unreadable.
 */
export function ghGet(endpoint: any, {bin = process.env.GH_BIN || 'gh', timeoutMs = 120_000}: any = {}) {
  try {
    return {ok: true, data: JSON.parse(execFileSync(bin, ['api', '--method', 'GET', endpoint], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL'}))};
  } catch (error: any) {
    if (error.code === 'ETIMEDOUT') return {ok: false, status: 0, message: `gh timed out after ${timeoutMs / 1000}s`};
    const text = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    const status = Number(/\(HTTP (\d{3})\)/.exec(text)?.[1] ?? /"status":\s*"(\d{3})"/.exec(text)?.[1] ?? 0);
    return {ok: false, status, message: text.split('\n').pop() || error.message};
  }
}

export function repositoryFromRemote(url: any) {
  return /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1] ?? null;
}

const intendedChecks = (intended: any) => intended.rules.find((rule: any) => rule.type === 'required_status_checks').parameters;

/**
 * @param {object} input
 * @param {object} input.intended the committed ruleset
 * @param {Array|null} input.branchRules GET /repos/{repo}/rules/branches/{branch} (active rules only), or null when unreadable
 * @param {Array} input.rulesets ruleset details (GET /repos/{repo}/rulesets/{id}) for every repository ruleset that could be read
 * @param {object|null} input.protection GET /repos/{repo}/branches/{branch}/protection, or null when there is none or it is unreadable
 * @returns {{ok: boolean, enforced: Array<{context: string, integrationId: number|null, source: string}>, problems: string[], notes: string[]}}
 */
export function compareRequiredChecks({intended, branchRules, rulesets = [], protection = null}: any) {
  const problems: any[] = [], notes: any[] = [];
  const want = intendedChecks(intended);
  const enforced: any[] = [];
  let strict: any = null;
  for (const rule of branchRules ?? []) {
    if (rule.type !== 'required_status_checks') continue;
    const source = `ruleset ${rule.ruleset_id}${rulesets.find((set: any) => set.id === rule.ruleset_id)?.name ? ` "${rulesets.find((set: any) => set.id === rule.ruleset_id).name}"` : ''}`;
    if (rule.parameters?.strict_required_status_checks_policy === true) strict = source;
    for (const check of rule.parameters?.required_status_checks ?? [])
      enforced.push({context: check.context, integrationId: check.integration_id ?? null, source});
  }
  const classic = protection?.required_status_checks;
  if (classic) {
    if (classic.strict === true) strict = 'classic branch protection';
    const checks = classic.checks?.length ? classic.checks : (classic.contexts ?? []).map((context: any) => ({context, app_id: null}));
    for (const check of checks) enforced.push({context: check.context, integrationId: check.app_id ?? null, source: 'classic branch protection'});
  }
  if (branchRules === null) problems.push('The active rules for the branch could not be read, so enforcement is unknown.');
  for (const check of want.required_status_checks) {
    const rows = enforced.filter((row: any) => row.context === check.context);
    if (!rows.length) problems.push(`MISSING required check "${check.context}": merges are not blocked when it is absent or failing.`);
    else if (!rows.some((row: any) => row.integrationId === check.integration_id))
      problems.push(`Required check "${check.context}" is not bound to integration ${check.integration_id} (GitHub Actions); found ${rows.map((row: any) => row.integrationId ?? 'any source').join(', ')} in ${rows[0].source}. Another app could report it.`);
  }
  const wanted = new Set(want.required_status_checks.map((check: any) => check.context));
  for (const row of enforced)
    if (!wanted.has(row.context)) problems.push(`UNEXPECTED required check "${row.context}" (${row.source}): not in ${INTENDED_FILE}; a renamed or sharded job name here blocks every merge or hides a gap.`);
  if (strict && want.strict_required_status_checks_policy === false)
    problems.push(`Up-to-date branches are required by ${strict}; the intended policy leaves this off.`);

  const named = rulesets.find((set: any) => set.name === intended.name);
  if (!named) problems.push(`Ruleset "${intended.name}" is not installed.`);
  else {
    if (named.enforcement !== intended.enforcement) problems.push(`Ruleset "${intended.name}" enforcement is "${named.enforcement}", intended "${intended.enforcement}".`);
    if (named.target !== intended.target) problems.push(`Ruleset "${intended.name}" targets "${named.target}", intended "${intended.target}".`);
    const include = named.conditions?.ref_name?.include ?? [];
    if (JSON.stringify(include) !== JSON.stringify(intended.conditions.ref_name.include)) problems.push(`Ruleset "${intended.name}" applies to ${JSON.stringify(include)}, intended ${JSON.stringify(intended.conditions.ref_name.include)}.`);
    if ((named.conditions?.ref_name?.exclude ?? []).length) problems.push(`Ruleset "${intended.name}" excludes ${JSON.stringify(named.conditions.ref_name.exclude)}; intended no exclusions.`);
    // GitHub omits bypass_actors for callers who cannot administer the repository.
    if (!Array.isArray(named.bypass_actors)) notes.push(`Bypass actors of "${intended.name}" are not visible to this account; an administrator must confirm the list is empty.`);
    else if (named.bypass_actors.length) problems.push(`Ruleset "${intended.name}" has ${named.bypass_actors.length} bypass actor(s); intended none, so the checks can be skipped silently.`);
  }
  for (const set of rulesets)
    if (set.name !== intended.name) notes.push(`Other ruleset: "${set.name}" (${set.enforcement}; rules: ${(set.rules ?? []).map((rule: any) => rule.type).join(', ') || 'not visible'}).`);
  return {ok: problems.length === 0, enforced, problems, notes};
}

function main(argv: any) {
  const value = (flag: any) => argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null;
  const unknown = argv.filter((arg: any, index: any) => arg.startsWith('--') ? !['--repo', '--branch', '--json'].includes(arg) : !['--repo', '--branch'].includes(argv[index - 1]));
  if (unknown.length) { console.error('Usage: node scripts/ci/read-required-checks.ts [--repo owner/name] [--branch main] [--json]'); return 2; }
  let repo = value('--repo');
  if (!repo) {
    try { repo = repositoryFromRemote(execFileSync('git', ['remote', 'get-url', 'origin'], {cwd: ROOT, encoding: 'utf8'})); } catch { repo = null; }
  }
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) { console.error('Cannot determine the repository; pass --repo owner/name.'); return 2; }
  const intended = JSON.parse(fs.readFileSync(path.join(ROOT, INTENDED_FILE), 'utf8'));
  const unreadable: any[] = [];
  const read = (label: any, endpoint: any, {absentStatus = []}: any = {}) => {
    const result = ghGet(endpoint);
    if (result.ok) return result.data;
    if (!absentStatus.includes(result.status)) unreadable.push(`${label}: GET ${endpoint} failed (${result.status || 'no HTTP status'}: ${result.message})`);
    return null;
  };
  const branch = value('--branch') ?? read('repository', `repos/${repo}`)?.default_branch;
  if (!branch) { for (const line of unreadable) console.error(`UNREADABLE ${line}`); return 2; }
  const branchRules = read('active branch rules', `repos/${repo}/rules/branches/${encodeURIComponent(branch)}?per_page=100`);
  const list = read('rulesets', `repos/${repo}/rulesets?includes_parents=true&per_page=100`) ?? [];
  const rulesets = list.map((set: any) => read(`ruleset ${set.id}`, set.source_type === 'Organization' ? `orgs/${repo.split('/')[0]}/rulesets/${set.id}` : `repos/${repo}/rulesets/${set.id}`) ?? set);
  // 404 means the branch has no classic protection; that is a state, not a read failure.
  const protection = read('classic branch protection', `repos/${repo}/branches/${encodeURIComponent(branch)}/protection`, {absentStatus: [404]});
  const result = compareRequiredChecks({intended, branchRules, rulesets, protection});
  if (argv.includes('--json')) { console.log(JSON.stringify({repo, branch, intended: intendedChecks(intended).required_status_checks, ...result, unreadable}, null, 2)); return unreadable.length ? 2 : result.ok ? 0 : 1; }

  console.log(`Repository ${repo}, branch ${branch} (read-only; nothing was changed)`);
  console.log(`Intended (${INTENDED_FILE}, ruleset "${intended.name}"):`);
  for (const check of intendedChecks(intended).required_status_checks) console.log(`  - ${check.context} (integration ${check.integration_id})`);
  console.log('Active rules on the branch:');
  for (const rule of branchRules ?? []) console.log(`  - ${rule.type} (ruleset ${rule.ruleset_id})`);
  if (!branchRules?.length) console.log('  (none readable)');
  console.log(`Classic branch protection: ${protection ? 'present' : 'none or not readable'}`);
  console.log('Enforced required status checks:');
  for (const row of result.enforced) console.log(`  - ${row.context} (integration ${row.integrationId ?? 'any'}; ${row.source})`);
  if (!result.enforced.length) console.log('  (none)');
  for (const note of result.notes) console.log(`NOTE ${note}`);
  for (const line of unreadable) console.log(`UNREADABLE ${line}`);
  for (const problem of result.problems) console.log(`DIFF ${problem}`);
  if (result.ok && !unreadable.length) {
    console.log('MATCH The default branch enforces exactly the intended required checks. Still required for MVP-46: a controlled PR showing a missing or failing check blocks the merge.');
    return 0;
  }
  if (!result.ok) {
    console.log('\nThe repository owner must install or correct the ruleset. This script does not do it:');
    console.log(named(result) ? `  Review ruleset "${intended.name}" in Settings > Rules > Rulesets against ${INTENDED_FILE}.`
      : `  gh api --method POST repos/${repo}/rulesets --input ${INTENDED_FILE}`);
    console.log(`  then confirm with: node scripts/ci/read-required-checks.ts --repo ${repo}`);
  }
  return unreadable.length ? 2 : 1;
}
const named = (result: any) => !result.problems.some((problem: any) => problem.endsWith('is not installed.'));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
