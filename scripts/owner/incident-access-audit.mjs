#!/usr/bin/env node
/**
 * Issue #658 step 2 evidence: who and what can still write to the affected repositories.
 *
 *   node scripts/owner/incident-access-audit.mjs [--repo owner/name ...] [--all] [--actor login] [--json]
 *
 * Per repository: outside collaborators, pending invitations, the actor's effective permission,
 * deploy keys (id, title, read-only flag, dates; never the key material) and webhooks (id,
 * events and destination HOST only, because a hook URL can embed a token).
 * Per organization: whether the actor is a member, outside collaborator or invitee, the GitHub
 * App installations, and (Enterprise Cloud, org admin) the count of audit-log events by action
 * for the actor since the review start in the IOC file.
 *
 * --all covers all 26 repositories in scripts/owner/incident-2026-10-27-iocs.json (default when
 * no --repo is given). --actor defaults to the IOC actor. GH_BIN selects the gh binary.
 *
 * READ-ONLY: only `gh api --method GET`. Nothing is revoked, removed or changed.
 * Exit: 0 all reads succeeded and the actor has no access, 1 the actor still has some access,
 * 2 something could not be read (usually missing admin rights).
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ghGet, ghGetAll, loadIocs, fullName, parseArgs, unreadableNote} from './gh-readonly.mjs';

export function hostOf(url) {
  try { return new URL(url).host || '(no host)'; } catch { return '(unparseable)'; }
}

export const keyRow = key => ({id: key.id, title: key.title, read_only: key.read_only, created_at: key.created_at, last_used: key.last_used ?? null, added_by: key.added_by ?? null});
export const hookRow = hook => ({id: hook.id, active: hook.active, events: hook.events, host: hostOf(hook.config?.url ?? ''), created_at: hook.created_at, updated_at: hook.updated_at});

/**
 * Effective permission of `actor` from GET .../collaborators/{actor}/permission; 404 means none.
 * On a public repository GitHub reports `read` for every account, so `read` there is not access.
 */
export function actorPermission(result, {isPublic = false} = {}) {
  if (!result.ok) return result.status === 404 ? 'none' : null;
  const role = result.data?.role_name || result.data?.permission || 'unknown';
  return isPublic && role === 'read' ? 'none (public read)' : role;
}

export const grantsAccess = permission => Boolean(permission) && !permission.startsWith('none');

export function auditRepository(repo, actor, {get = ghGet} = {}) {
  const unreadable = [];
  const list = (label, endpoint, pick) => {
    const result = ghGetAll(endpoint, {pick, get});
    if (!result.ok) { unreadable.push(`${label}: ${unreadableNote(result)}`); return []; }
    return result.data;
  };
  const meta = get(`repos/${repo}`);
  if (!meta.ok) unreadable.push(`repository: ${unreadableNote(meta)}`);
  const permissionResult = get(`repos/${repo}/collaborators/${encodeURIComponent(actor)}/permission`);
  const permission = actorPermission(permissionResult, {isPublic: meta.ok && meta.data?.visibility === 'public'});
  if (permission === null) unreadable.push(`permission of ${actor}: ${unreadableNote(permissionResult)}`);
  return {
    repo,
    visibility: meta.ok ? meta.data?.visibility : null,
    actorPermission: permission,
    outsideCollaborators: list('outside collaborators', `repos/${repo}/collaborators?affiliation=outside`, page => page)
      .map(user => ({login: user.login, role: user.role_name ?? null})),
    invitations: list('pending invitations', `repos/${repo}/invitations`, page => page)
      .map(invite => ({invitee: invite.invitee?.login ?? null, inviter: invite.inviter?.login ?? null, permissions: invite.permissions, created_at: invite.created_at})),
    deployKeys: list('deploy keys', `repos/${repo}/keys`, page => page).map(keyRow),
    webhooks: list('webhooks', `repos/${repo}/hooks`, page => page).map(hookRow),
    unreadable,
  };
}

/** Count audit-log events by action (no event bodies are kept). */
export function summarizeAudit(events) {
  const counts = {};
  for (const event of events) counts[event.action ?? 'unknown'] = (counts[event.action ?? 'unknown'] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort());
}

export function auditOrganization(org, actor, since, {get = ghGet} = {}) {
  const unreadable = [];
  const membership = get(`orgs/${org}/members/${encodeURIComponent(actor)}`);
  // 204 (empty body) means member; 404 means not a member (or not visible to the caller).
  const member = membership.ok ? true : membership.status === 404 ? false : null;
  if (member === null) unreadable.push(`membership of ${actor}: ${unreadableNote(membership)}`);
  const list = (label, endpoint, pick) => {
    const result = ghGetAll(endpoint, {pick, get});
    if (!result.ok) { unreadable.push(`${label}: ${unreadableNote(result)}`); return null; }
    if (result.truncated) unreadable.push(`${label}: incomplete (${result.truncated})`);
    return result.data;
  };
  const outside = list('organization outside collaborators', `orgs/${org}/outside_collaborators`, page => page);
  const invitations = list('organization invitations', `orgs/${org}/invitations`, page => page);
  const installations = list('GitHub App installations', `orgs/${org}/installations`, page => page.installations);
  const audit = list(`audit log for ${actor}`, `orgs/${org}/audit-log?phrase=${encodeURIComponent(`actor:${actor} created:>=${since.slice(0, 10)}`)}&include=all`, page => page);
  return {
    org,
    actorIsMember: member,
    actorIsOutsideCollaborator: outside ? outside.some(user => user.login === actor) : null,
    actorInvited: invitations ? invitations.some(invite => invite.login === actor) : null,
    installations: (installations ?? []).map(app => ({app: app.app_slug, id: app.id, selection: app.repository_selection, created_at: app.created_at, updated_at: app.updated_at, suspended_at: app.suspended_at ?? null})),
    auditEventsByAction: audit ? summarizeAudit(audit) : null,
    unreadable,
  };
}

export const actorHasAccess = (repos, orgs) =>
  repos.some(repo => grantsAccess(repo.actorPermission)
    || repo.outsideCollaborators.some(user => user.login === repo.actor)
    || repo.invitations.some(invite => invite.invitee === repo.actor))
  || orgs.some(org => org.actorIsMember || org.actorIsOutsideCollaborator || org.actorInvited);

function print(repos, orgs, actor) {
  console.log(`Read-only access audit for actor ${actor} (nothing was changed).`);
  for (const org of orgs) {
    console.log(`\n# organization ${org.org}`);
    console.log(`  ${actor}: member ${org.actorIsMember ?? 'unknown'}; outside collaborator ${org.actorIsOutsideCollaborator ?? 'unknown'}; invited ${org.actorInvited ?? 'unknown'}`);
    for (const app of org.installations) console.log(`  app ${app.app} (installation ${app.id}, ${app.selection}) created ${app.created_at} updated ${app.updated_at}${app.suspended_at ? ' SUSPENDED' : ''}`);
    if (org.auditEventsByAction) console.log(`  audit events for ${actor}: ${JSON.stringify(org.auditEventsByAction)}`);
    for (const line of org.unreadable) console.log(`  UNREADABLE ${line}`);
  }
  for (const repo of repos) {
    console.log(`\n## ${repo.repo} (${repo.visibility ?? 'visibility unknown'})`);
    console.log(`  ${actor} permission: ${repo.actorPermission ?? 'unknown'}`);
    for (const user of repo.outsideCollaborators) console.log(`  outside collaborator ${user.login} (${user.role ?? '?'})`);
    for (const invite of repo.invitations) console.log(`  pending invitation ${invite.invitee} by ${invite.inviter} (${invite.permissions}) ${invite.created_at}`);
    for (const key of repo.deployKeys) console.log(`  deploy key ${key.id} "${key.title}" ${key.read_only ? 'read-only' : 'WRITE'} created ${key.created_at} last used ${key.last_used ?? '?'}`);
    for (const hook of repo.webhooks) console.log(`  webhook ${hook.id} -> ${hook.host} ${hook.active ? 'active' : 'inactive'} [${hook.events.join(',')}] updated ${hook.updated_at}`);
    for (const line of repo.unreadable) console.log(`  UNREADABLE ${line}`);
  }
}

function main(argv) {
  let args;
  try { args = parseArgs(argv, {flags: ['--all', '--json'], options: ['--actor'], multi: ['--repo']}); }
  catch (error) { console.error(`${error.message}\nUsage: node scripts/owner/incident-access-audit.mjs [--repo owner/name ...] [--all] [--actor login] [--json]`); return 2; }
  const iocs = loadIocs();
  const actor = args.actor ?? iocs.actor;
  const repoNames = args.repo?.length && !args.all ? args.repo : iocs.repositories.map(repo => fullName(iocs, repo));
  const repos = repoNames.map(repo => ({...auditRepository(repo, actor), actor}));
  const orgs = [...new Set(repoNames.map(repo => repo.split('/')[0]))].map(org => auditOrganization(org, actor, iocs.window.reviewFrom));
  if (args.json) console.log(JSON.stringify({generatedAt: new Date().toISOString(), actor, orgs, repos}, null, 2));
  else print(repos, orgs, actor);
  if ([...repos, ...orgs].some(row => row.unreadable.length)) return 2;
  return actorHasAccess(repos, orgs) ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
