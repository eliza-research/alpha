#!/usr/bin/env node
/**
 * Issue #658 step 4 evidence: read back what actually blocks force-pushes, deletion and unsigned
 * commits on shared branches, and name the ruleset (or classic protection) that enforces each,
 * with the bypass actors of every enforcing ruleset.
 *
 *   node scripts/owner/read-branch-integrity.ts [--repo owner/name] [--branch main ...] [--allow-bypass] [--json]
 *
 * Defaults: --repo from the IOC file's alphaphone owner, branches main and develop.
 * READ-ONLY: only `gh api --method GET`. Installing a ruleset is the owner's action; the commands
 * remain in Git history. Exit: 0 every branch enforces all three with
 * no bypass actors (bypass actors are accepted with --allow-bypass), 1 something is missing or can
 * be bypassed, 2 the state could not be read (including a ruleset whose bypass actors are hidden).
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ghGet, loadIocs, fullName, parseArgs, unreadableNote} from './gh-readonly.ts';

export const REQUIRED = ['non_fast_forward', 'deletion', 'required_signatures'];

/**
 * @param {Array} branchRules GET /repos/{r}/rules/branches/{b}: active rules with ruleset_id
 * @param {Map<number,string>} rulesetNames id -> name
 * @param {object|null} protection classic protection, or null when absent
 * @param {Set<number>} evaluateOnly ids of rulesets in `evaluate` mode (reported, not counted as enforcing)
 * @param {Map<number,Array>} bypassActors id -> bypass_actors from GET the ruleset detail
 * @param {boolean} allowBypass accept enforcing rulesets that have bypass actors
 */
export function compareIntegrity({branchRules = [], rulesetNames = new Map(), protection = null, evaluateOnly = new Set(), bypassActors = new Map(), allowBypass = false}: any) {
  const enforcedBy = Object.fromEntries(REQUIRED.map((type: any) => [type, []]));
  const evaluating = Object.fromEntries(REQUIRED.map((type: any) => [type, []]));
  const bypassable = new Set();
  for (const rule of branchRules) {
    if (!REQUIRED.includes(rule.type)) continue;
    const actors = evaluateOnly.has(rule.ruleset_id) ? [] : bypassActors.get(rule.ruleset_id) ?? [];
    const name = `ruleset "${rulesetNames.get(rule.ruleset_id) ?? rule.ruleset_id}"`;
    if (actors.length) bypassable.add(name);
    (evaluateOnly.has(rule.ruleset_id) ? evaluating : enforcedBy)[rule.type].push(actors.length ? `${name} (bypass: ${actors.map(describeActor).join('; ')})` : name);
  }
  if (protection) {
    const admins = protection.enforce_admins?.enabled ? '' : ' (admins can bypass: enforce_admins off)';
    if (protection.allow_force_pushes?.enabled === false) enforcedBy.non_fast_forward.push(`classic protection${admins}`);
    if (protection.allow_deletions?.enabled === false) enforcedBy.deletion.push(`classic protection${admins}`);
    if (protection.required_signatures?.enabled === true) enforcedBy.required_signatures.push(`classic protection${admins}`);
  }
  const missing = REQUIRED.filter((type: any) => !enforcedBy[type].length);
  return {ok: missing.length === 0 && (allowBypass || !bypassable.size), enforcedBy, evaluating, missing, bypassable: [...bypassable]};
}

const describeActor = (actor: any) => [actor.actor_type, actor.actor_type === 'OrganizationAdmin' ? null : actor.actor_id, actor.bypass_mode].filter((part: any) => part != null).join(' ');

function main(argv: any) {
  let args;
  try { args = parseArgs(argv, {flags: ['--json', '--allow-bypass'], options: ['--repo'], multi: ['--branch']}); }
  catch (error: any) { console.error(`${error.message}\nUsage: node scripts/owner/read-branch-integrity.ts [--repo owner/name] [--branch main ...] [--allow-bypass] [--json]`); return 2; }
  const repo = args.repo ?? fullName(loadIocs(), 'alphaphone');
  const branches = args.branch?.length ? args.branch : ['main', 'develop'];
  const unreadable: any[] = [];
  const list = ghGet(`repos/${repo}/rulesets?includes_parents=true&per_page=100`);
  if (!list.ok) unreadable.push(`rulesets: ${unreadableNote(list)}`);
  const rulesets = list.ok ? list.data : [];
  const rulesetNames = new Map(rulesets.map((set: any) => [set.id, set.name]));
  const evaluateOnly = new Set(rulesets.filter((set: any) => set.enforcement === 'evaluate').map((set: any) => set.id));
  const reads = branches.map((branch: any) => {
    const enc = encodeURIComponent(branch);
    const rules = ghGet(`repos/${repo}/rules/branches/${enc}?per_page=100`);
    if (!rules.ok) unreadable.push(`${branch} rules: ${unreadableNote(rules)}`);
    const protection = ghGet(`repos/${repo}/branches/${enc}/protection`);
    if (!protection.ok && protection.status !== 404) unreadable.push(`${branch} classic protection: ${unreadableNote(protection)}`);
    return {branch, branchRules: rules.ok ? rules.data : [], protection: protection.ok ? protection.data : null};
  });
  // The ruleset list does not carry bypass actors; read the detail of every ruleset that enforces a rule.
  const enforcing = new Set(reads.flatMap((read: any) => read.branchRules).filter((rule: any) => REQUIRED.includes(rule.type) && !evaluateOnly.has(rule.ruleset_id)).map((rule: any) => rule.ruleset_id));
  const bypassActors = new Map(), details = new Map();
  for (const id of enforcing) {
    const set = rulesets.find((row: any) => row.id === id);
    const detail = ghGet(set?.source_type === 'Organization' ? `orgs/${set.source}/rulesets/${id}` : `repos/${repo}/rulesets/${id}`);
    // GitHub omits bypass_actors for callers who cannot administer the ruleset.
    if (!detail.ok) unreadable.push(`ruleset ${id} detail: ${unreadableNote(detail)}`);
    else if (!Array.isArray(detail.data?.bypass_actors)) unreadable.push(`ruleset ${id} detail: bypass actors are not visible to this account`);
    else {
      bypassActors.set(id, detail.data.bypass_actors);
      details.set(id, {bypassActors: detail.data.bypass_actors, currentUserCanBypass: detail.data.current_user_can_bypass ?? null});
    }
  }
  const results = reads.map(({branch, branchRules, protection}: any) => ({branch, ...compareIntegrity({branchRules, rulesetNames, protection, evaluateOnly, bypassActors, allowBypass: args['allow-bypass'] === true})}));
  if (args.json) console.log(JSON.stringify({repo, rulesets: rulesets.map((set: any) => ({id: set.id, name: set.name, enforcement: set.enforcement, source: set.source, ...details.get(set.id)})), results, unreadable}, null, 2));
  else {
    console.log(`Repository ${repo} (read-only; nothing was changed)`);
    for (const set of rulesets) {
      const detail = details.get(set.id);
      console.log(`  ruleset ${set.id} "${set.name}" ${set.enforcement} (${set.source_type ?? 'Repository'} ${set.source ?? ''})${detail ? `; bypass actors: ${detail.bypassActors.length}; current user can bypass: ${detail.currentUserCanBypass ?? 'unknown'}` : ''}`);
    }
    if (!rulesets.length) console.log('  (no rulesets)');
    for (const row of results) {
      console.log(`Branch ${row.branch}:`);
      for (const type of REQUIRED) console.log(`  ${type}: ${row.enforcedBy[type].join('; ') || 'NOT ENFORCED'}${row.evaluating[type].length ? ` (evaluate only: ${row.evaluating[type].join('; ')})` : ''}`);
      for (const name of row.bypassable) console.log(`  BYPASS ${name} has bypass actors${args['allow-bypass'] ? ' (accepted with --allow-bypass)' : ''}`);
    }
    for (const line of unreadable) console.log(`UNREADABLE ${line}`);
  }
  if (unreadable.length) return 2;
  return results.every((row: any) => row.ok) ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
