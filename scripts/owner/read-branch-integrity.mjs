#!/usr/bin/env node
/**
 * Issue #658 step 4 evidence: read back what actually blocks force-pushes, deletion and unsigned
 * commits on shared branches, and name the ruleset (or classic protection) that enforces each.
 *
 *   node scripts/owner/read-branch-integrity.mjs [--repo owner/name] [--branch main ...] [--json]
 *
 * Defaults: --repo from the IOC file's alphaphone owner, branches main and develop.
 * READ-ONLY: only `gh api --method GET`. Installing a ruleset is the owner's action; the commands
 * are in docs/runbooks/658-forged-commit-incident.md. Exit: 0 every branch enforces all three,
 * 1 something is missing, 2 the state could not be read.
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ghGet, loadIocs, fullName, parseArgs, unreadableNote} from './gh-readonly.mjs';

export const REQUIRED = ['non_fast_forward', 'deletion', 'required_signatures'];

/**
 * @param {Array} branchRules GET /repos/{r}/rules/branches/{b}: active rules with ruleset_id
 * @param {Map<number,string>} rulesetNames id -> name
 * @param {object|null} protection classic protection, or null when absent
 * @param {Set<number>} evaluateOnly ids of rulesets in `evaluate` mode (reported, not counted as enforcing)
 */
export function compareIntegrity({branchRules = [], rulesetNames = new Map(), protection = null, evaluateOnly = new Set()}) {
  const enforcedBy = Object.fromEntries(REQUIRED.map(type => [type, []]));
  const evaluating = Object.fromEntries(REQUIRED.map(type => [type, []]));
  for (const rule of branchRules) {
    if (!REQUIRED.includes(rule.type)) continue;
    const name = `ruleset "${rulesetNames.get(rule.ruleset_id) ?? rule.ruleset_id}"`;
    (evaluateOnly.has(rule.ruleset_id) ? evaluating : enforcedBy)[rule.type].push(name);
  }
  if (protection) {
    const admins = protection.enforce_admins?.enabled ? '' : ' (admins can bypass: enforce_admins off)';
    if (protection.allow_force_pushes?.enabled === false) enforcedBy.non_fast_forward.push(`classic protection${admins}`);
    if (protection.allow_deletions?.enabled === false) enforcedBy.deletion.push(`classic protection${admins}`);
    if (protection.required_signatures?.enabled === true) enforcedBy.required_signatures.push(`classic protection${admins}`);
  }
  const missing = REQUIRED.filter(type => !enforcedBy[type].length);
  return {ok: missing.length === 0, enforcedBy, evaluating, missing};
}

function main(argv) {
  let args;
  try { args = parseArgs(argv, {flags: ['--json'], options: ['--repo'], multi: ['--branch']}); }
  catch (error) { console.error(`${error.message}\nUsage: node scripts/owner/read-branch-integrity.mjs [--repo owner/name] [--branch main ...] [--json]`); return 2; }
  const repo = args.repo ?? fullName(loadIocs(), 'alphaphone');
  const branches = args.branch?.length ? args.branch : ['main', 'develop'];
  const unreadable = [];
  const list = ghGet(`repos/${repo}/rulesets?includes_parents=true&per_page=100`);
  if (!list.ok) unreadable.push(`rulesets: ${unreadableNote(list)}`);
  const rulesets = list.ok ? list.data : [];
  const rulesetNames = new Map(rulesets.map(set => [set.id, set.name]));
  const evaluateOnly = new Set(rulesets.filter(set => set.enforcement === 'evaluate').map(set => set.id));
  const results = branches.map(branch => {
    const enc = encodeURIComponent(branch);
    const rules = ghGet(`repos/${repo}/rules/branches/${enc}?per_page=100`);
    if (!rules.ok) unreadable.push(`${branch} rules: ${unreadableNote(rules)}`);
    const protection = ghGet(`repos/${repo}/branches/${enc}/protection`);
    if (!protection.ok && protection.status !== 404) unreadable.push(`${branch} classic protection: ${unreadableNote(protection)}`);
    return {branch, ...compareIntegrity({branchRules: rules.ok ? rules.data : [], rulesetNames, protection: protection.ok ? protection.data : null, evaluateOnly})};
  });
  if (args.json) console.log(JSON.stringify({repo, rulesets: rulesets.map(set => ({id: set.id, name: set.name, enforcement: set.enforcement, source: set.source})), results, unreadable}, null, 2));
  else {
    console.log(`Repository ${repo} (read-only; nothing was changed)`);
    for (const set of rulesets) console.log(`  ruleset ${set.id} "${set.name}" ${set.enforcement} (${set.source_type ?? 'Repository'} ${set.source ?? ''})`);
    if (!rulesets.length) console.log('  (no rulesets)');
    for (const row of results) {
      console.log(`Branch ${row.branch}:`);
      for (const type of REQUIRED) console.log(`  ${type}: ${row.enforcedBy[type].join('; ') || 'NOT ENFORCED'}${row.evaluating[type].length ? ` (evaluate only: ${row.evaluating[type].join('; ')})` : ''}`);
    }
    for (const line of unreadable) console.log(`UNREADABLE ${line}`);
  }
  if (unreadable.length) return 2;
  return results.every(row => row.ok) ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
