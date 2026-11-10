#!/usr/bin/env node
/**
 * Issue #658 step 2 evidence: who and what can still write to the affected repositories.
 *
 *   node scripts/owner/incident-access-audit.ts [--repo owner/name ...] [--all] [--actor login] [--json]
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
import {ghGet, ghGetAll, loadIocs, fullName, parseArgs, unreadableNote, collectRows, type GitHubRead, type GitHubResult} from './gh-readonly.ts';

type User = {login: string; role_name?: string};
type Invitation = {invitee?: User; inviter?: User; permissions?: string; created_at?: string};
type DeployKey = {id: number; title: string; read_only: boolean; created_at: string; last_used?: string; added_by?: string};
type Webhook = {id: number; active: boolean; events: string[]; config?: {url?: string}; created_at: string; updated_at: string};
type ActorPermission = {role_name?: string; permission?: string};
type AppInstallation = {
  app_slug: string; id: number; repository_selection: string;
  created_at: string; updated_at: string; suspended_at?: string;
};
type AuditEvent = {action?: string};

export function hostOf(url: string) {
  try { return new URL(url).host || '(no host)'; } catch { return '(unparseable)'; }
}

export const keyRow = (key: DeployKey) => ({id: key.id, title: key.title, read_only: key.read_only, created_at: key.created_at, last_used: key.last_used ?? null, added_by: key.added_by ?? null});
export const hookRow = (hook: Webhook) => ({id: hook.id, active: hook.active, events: hook.events, host: hostOf(hook.config?.url ?? ''), created_at: hook.created_at, updated_at: hook.updated_at});

/**
 * Effective permission of `actor` from GET .../collaborators/{actor}/permission; 404 means none.
 * On a public repository GitHub reports `read` for every account, so `read` there is not access.
 */
export function actorPermission(result: GitHubResult<ActorPermission>, {isPublic = false} = {}) {
  if (!result.ok) return result.status === 404 ? 'none' : null;
  const role = result.data?.role_name || result.data?.permission || 'unknown';
  return isPublic && role === 'read' ? 'none (public read)' : role;
}

export const grantsAccess = (permission: string | null) => !!permission && !permission.startsWith('none');

export function auditRepository(repo: string, actor: string, {get = ghGet}: {get?: GitHubRead} = {}) {
  const unreadable: string[] = [];
  const list = <Row>(label: string, endpoint: string) =>
    collectRows(ghGetAll<Row>(endpoint, {get}), label, unreadable) ?? [];
  const meta = get<{visibility?: string}>(`repos/${repo}`);
  if (!meta.ok) unreadable.push(`repository: ${unreadableNote(meta)}`);
  const permissionResult = get<ActorPermission>(`repos/${repo}/collaborators/${encodeURIComponent(actor)}/permission`);
  const permission = actorPermission(permissionResult, {isPublic: meta.ok && meta.data?.visibility === 'public'});
  if (permission === null && !permissionResult.ok) unreadable.push(`permission of ${actor}: ${unreadableNote(permissionResult)}`);
  return {
    repo,
    visibility: meta.ok ? meta.data?.visibility : null,
    actorPermission: permission,
    outsideCollaborators: list<User>('outside collaborators', `repos/${repo}/collaborators?affiliation=outside`)
      .map(user => ({login: user.login, role: user.role_name ?? null})),
    invitations: list<Invitation>('pending invitations', `repos/${repo}/invitations`)
      .map(invite => ({invitee: invite.invitee?.login ?? null, inviter: invite.inviter?.login ?? null, permissions: invite.permissions, created_at: invite.created_at})),
    deployKeys: list<DeployKey>('deploy keys', `repos/${repo}/keys`).map(keyRow),
    webhooks: list<Webhook>('webhooks', `repos/${repo}/hooks`).map(hookRow),
    unreadable,
  };
}

/** Count audit-log events by action (no event bodies are kept). */
export function summarizeAudit(events: readonly AuditEvent[]) {
  const counts = new Map<string,number>();
  for (const event of events) {
    const action = event.action ?? 'unknown';
    counts.set(action, (counts.get(action) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort());
}

export function auditOrganization(org: string, actor: string, since: string, {get = ghGet}: {get?: GitHubRead} = {}) {
  const unreadable: string[] = [];
  const membership = get(`orgs/${org}/members/${encodeURIComponent(actor)}`);
  // 204 (empty body) means member; 404 means not a member (or not visible to the caller).
  const member = membership.ok ? true : membership.status === 404 ? false : null;
  if (member === null && !membership.ok) unreadable.push(`membership of ${actor}: ${unreadableNote(membership)}`);
  const list = <Row>(label: string, endpoint: string) =>
    collectRows(ghGetAll<Row>(endpoint, {get}), label, unreadable);
  const outside = list<User>('organization outside collaborators', `orgs/${org}/outside_collaborators`);
  const invitations = list<User>('organization invitations', `orgs/${org}/invitations`);
  const installations = collectRows(ghGetAll<AppInstallation, {installations?: AppInstallation[]}>(
    `orgs/${org}/installations`, {get, pick: page => page.installations},
  ), 'GitHub App installations', unreadable);
  const audit = list<AuditEvent>(`audit log for ${actor}`, `orgs/${org}/audit-log?phrase=${encodeURIComponent(`actor:${actor} created:>=${since.slice(0, 10)}`)}&include=all`);
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

type RepoAudit = ReturnType<typeof auditRepository> & {actor?: string};
type OrgAudit = ReturnType<typeof auditOrganization>;
export const actorHasAccess = (repos: readonly RepoAudit[], orgs: readonly OrgAudit[]) =>
  repos.some(repo => grantsAccess(repo.actorPermission)
    || repo.outsideCollaborators.some(user => user.login === repo.actor)
    || repo.invitations.some(invite => invite.invitee === repo.actor))
  || orgs.some(org => org.actorIsMember || org.actorIsOutsideCollaborator || org.actorInvited);

function print(repos: readonly RepoAudit[], orgs: readonly OrgAudit[], actor: string) {
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

function main(argv: readonly string[]) {
  let args;
  try { args = parseArgs(argv, {flags: ['--all', '--json'], options: ['--actor'], multi: ['--repo']}); }
  catch (error) { console.error(`${error instanceof Error ? error.message : String(error)}\nUsage: node scripts/owner/incident-access-audit.ts [--repo owner/name ...] [--all] [--actor login] [--json]`); return 2; }
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
