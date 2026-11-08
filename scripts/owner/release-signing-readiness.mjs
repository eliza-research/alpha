#!/usr/bin/env node
/**
 * Read-only readiness check for the CI release-signing path (issue #661, H-01 decided 2026-10-29:
 * release keys live as GitHub Actions environment secrets and a CI job signs).
 *
 *   node scripts/owner/release-signing-readiness.mjs [--remote] [--repo OWNER/NAME] [--json]
 *
 * Local (files only):
 *   - the expected secret names, derived from android/signing/alpha-key-manifest.json;
 *   - the draft workflow docs/runbooks/drafts/661-release-signing.workflow.yml keeps its safety
 *     rules (workflow_dispatch only, main only, `release` environment, empty top-level permissions,
 *     step-level secrets, nothing printed or uploaded from the key directory);
 *   - whether any enabled workflow under .github/workflows already reads a release key secret;
 *   - whether android/release-signer.json has an enrolled signer (H-09).
 * --remote adds GitHub GET requests only (scripts/owner/gh-readonly.mjs): the `release`
 *   environment's protection rules and the NAMES and update times of its secrets and of the
 *   repository-level secrets. The GitHub API never returns secret values and this script never
 *   asks for one, prints one or sets one. Uploading secrets is the owner's step (runbook #661).
 *
 * A clean report is not a signature, a signed APK, an image, a boot or a device result.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ghGet, parseArgs, unreadableNote} from './gh-readonly.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DRAFT = 'docs/runbooks/drafts/661-release-signing.workflow.yml';
export const KEY_MANIFEST = 'android/signing/alpha-key-manifest.json';
export const RELEASE_SIGNER = 'android/release-signer.json';
export const ENVIRONMENT = 'release';
export const PASSPHRASE_SECRET = 'ALPHA_RELEASE_KEY_PASSPHRASE';
export const PUBLIC_BUNDLE_SECRET = 'ALPHA_RELEASE_PUBLIC_BUNDLE';
export const APP_KEY = 'alphaphone_app';
/** GitHub's documented size limit for one secret value. */
export const SECRET_LIMIT_BYTES = 48 * 1024;

export const keySecretName = name => `ALPHA_RELEASE_KEY_${name.toUpperCase()}`;

/** Every secret the draft needs, grouped by the job that reads it. */
export function expectedSecrets(manifest) {
  const names = manifest.keys.map(key => key.name);
  const image = names.filter(name => name !== APP_KEY);
  return {
    apks: [PASSPHRASE_SECRET, PUBLIC_BUNDLE_SECRET, keySecretName(APP_KEY)],
    image: [PASSPHRASE_SECRET, PUBLIC_BUNDLE_SECRET, ...image.map(keySecretName)],
    all: [PASSPHRASE_SECRET, PUBLIC_BUNDLE_SECRET, ...names.map(keySecretName)],
    files: Object.fromEntries(manifest.keys.map(key => [keySecretName(key.name), `${key.name}${key.kind === 'x509-pk8' ? '.pk8.enc' : '.pem.enc'}`])),
  };
}

/** Top-level `jobs:` children of a workflow, as {name, text}. Indentation-based, no YAML library. */
export function jobBlocks(text) {
  const lines = text.split('\n');
  const start = lines.findIndex(line => /^jobs:\s*$/.test(line));
  if (start < 0) return [];
  const jobs = [];
  for (let i = start + 1; i < lines.length; i++) {
    const head = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
    if (head) jobs.push({name: head[1], lines: []});
    else if (/^\S/.test(lines[i])) break;
    else if (jobs.length) jobs.at(-1).lines.push(lines[i]);
  }
  return jobs.map(job => ({name: job.name, text: job.lines.join('\n')}));
}

export const secretRefs = text => [...new Set([...text.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(match => match[1]))];

/** Safety problems of the draft workflow text; [] when every rule holds. */
export function draftProblems(text, expected) {
  const problems = [];
  const code = text.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
  const on = /^on:\s*\n((?: {2}.*\n?)*)/m.exec(code)?.[1] ?? '';
  const triggers = [...on.matchAll(/^ {2}([a-z_]+):/gm)].map(match => match[1]);
  if (triggers.join(',') !== 'workflow_dispatch') problems.push(`triggers must be workflow_dispatch only, found ${triggers.join(',') || 'none'}`);
  if (/pull_request/.test(code)) problems.push('mentions pull_request outside comments');
  if (!/^permissions:\s*\{\}\s*$/m.test(code)) problems.push('top-level permissions must be {}');
  if (/\$\{\{\s*secrets\.[A-Z0-9_]+\s*\}\}/.test(code.split(/^jobs:/m)[0])) problems.push('secrets referenced outside jobs');
  const jobs = jobBlocks(code);
  if (!jobs.length) problems.push('no jobs');
  for (const job of jobs) {
    const refs = secretRefs(job.text);
    if (!refs.length) continue;
    if (!new RegExp(`^ {4}environment: ${ENVIRONMENT}\\s*$`, 'm').test(job.text)) problems.push(`${job.name}: reads secrets without environment: ${ENVIRONMENT}`);
    if (!/^ {4}permissions:\s*\n {6}contents: read\s*$/m.test(job.text) || /^ {6}(?!contents: read)[a-z-]+: (write|read)/m.test(job.text))
      problems.push(`${job.name}: permissions must be contents: read only`);
    if (!/GITHUB_REF" = refs\/heads\/main/.test(job.text)) problems.push(`${job.name}: does not refuse refs other than main`);
    if (/^ {4}env:/m.test(job.text) && /^ {4}env:[\s\S]*?secrets\./m.test(job.text.split(/^ {4}steps:/m)[0])) problems.push(`${job.name}: secrets bound at job level`);
    const allowed = new Set(expected[job.name.replace(/^sign-/, '')] ?? []);
    for (const ref of refs) if (!allowed.has(ref)) problems.push(`${job.name}: reads ${ref}, which is not in its expected secret set`);
    for (const need of allowed) if (!refs.includes(need)) problems.push(`${job.name}: does not read ${need}`);
    if (/persist-credentials:\s*true/.test(job.text) || (/actions\/checkout@/.test(job.text) && !/persist-credentials:\s*false/.test(job.text))) problems.push(`${job.name}: checkout must set persist-credentials: false`);
    for (const use of job.text.matchAll(/uses:\s*([^\s#]+)/g)) {
      if (!/^actions\/[a-z-]+@[0-9a-f]{40}$/.test(use[1])) problems.push(`${job.name}: action ${use[1]} is not an actions/* action pinned by SHA`);
    }
    if (/\bset -x\b|\bcat\b[^\n]*(alpha-release|release-keys|\$keys|\$pass|\.pk8|\.pem)/.test(job.text)) problems.push(`${job.name}: may print key material (set -x or cat of a key path)`);
    if (/(echo|printf)[^\n|]*\$\{?ALPHA_RELEASE_[A-Z_]+[^\n]*$/m.test(job.text.replace(/printf '%s(\\n)?' "\$\{?!?[A-Za-z_]+\}?" (\||>)[^\n]*/g, '')))
      problems.push(`${job.name}: echoes a secret variable other than into a pipe or a file`);
    const uploads = [...job.text.matchAll(/upload-artifact@[\s\S]*?path:\s*(\|[\s\S]*?(?=\n {10}[a-z-]+:)|[^\n]+)/g)].map(match => match[1]);
    for (const upload of uploads) if (/dev\/shm|release-keys|alpha-release-pass|\.pk8|\.pem/.test(upload)) problems.push(`${job.name}: uploads a path that may hold key material`);
    if (!/^ {6}- name: Wipe key material\s*\n {8}if: always\(\)/m.test(job.text)) problems.push(`${job.name}: no always() step wipes the key directory`);
    if (!/sha256sum --check --strict/.test(job.text)) problems.push(`${job.name}: inputs are not pinned by SHA-256`);
  }
  return problems;
}

/** Enabled workflows that already read a release key secret (there should be none until enabled). */
export function enabledReaders(root = ROOT) {
  const dir = path.join(root, '.github/workflows');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(file => /\.ya?ml$/.test(file))
    .filter(file => /secrets\.ALPHA_RELEASE_/.test(fs.readFileSync(path.join(dir, file), 'utf8')))
    .map(file => `.github/workflows/${file}`);
}

export function localReport(root = ROOT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, KEY_MANIFEST), 'utf8'));
  const expected = expectedSecrets(manifest);
  const draftPath = path.join(root, DRAFT);
  const draft = fs.existsSync(draftPath) ? fs.readFileSync(draftPath, 'utf8') : null;
  const signer = JSON.parse(fs.readFileSync(path.join(root, RELEASE_SIGNER), 'utf8')).signerSha256;
  const enabled = enabledReaders(root);
  return {
    expectedSecrets: expected.all,
    secretFiles: expected.files,
    draft: draft === null ? {present: false, problems: [`${DRAFT} is missing`]} : {present: true, problems: draftProblems(draft, expected)},
    enabledWorkflows: enabled,
    enrolled: /^[0-9a-f]{64}$/.test(signer ?? ''),
    keyStorageLabels: Object.fromEntries(manifest.keys.map(key => [key.name, key.storage])),
  };
}

/** GET-only view of the environment and secret names. `get` is injectable for tests. */
export function remoteReport(repo, expected, {get = ghGet} = {}) {
  const report = {repo, environment: null, environmentSecrets: null, repositorySecrets: null, missing: [], unexpected: [], atRepositoryLevel: [], notes: []};
  const env = get(`repos/${repo}/environments/${ENVIRONMENT}`);
  if (!env.ok) {
    report.notes.push(env.status === 404 ? `environment ${ENVIRONMENT} does not exist` : `environment unreadable (${unreadableNote(env)})`);
  } else {
    const rules = env.data.protection_rules ?? [];
    const reviewers = rules.filter(rule => rule.type === 'required_reviewers').flatMap(rule => rule.reviewers ?? []).map(entry => entry.reviewer?.login ?? entry.reviewer?.slug ?? entry.type);
    const branches = get(`repos/${repo}/environments/${ENVIRONMENT}/deployment-branch-policies`);
    report.environment = {
      requiredReviewers: reviewers,
      preventSelfReview: rules.some(rule => rule.prevent_self_review === true),
      waitTimer: rules.find(rule => rule.type === 'wait_timer')?.wait_timer ?? 0,
      deploymentBranchPolicy: env.data.deployment_branch_policy ?? null,
      branchPolicies: branches.ok ? (branches.data.branch_policies ?? []).map(policy => `${policy.type ?? 'branch'}:${policy.name}`) : `unreadable (${unreadableNote(branches)})`,
      canAdminsBypass: env.data.can_admins_bypass ?? null,
    };
    if (!reviewers.length) report.notes.push('the environment has no required reviewer');
    if (env.data.can_admins_bypass) report.notes.push('admins can bypass the environment protection rules (can_admins_bypass: true)');
    if (Array.isArray(report.environment.branchPolicies) && report.environment.branchPolicies.join(',') !== 'branch:main') report.notes.push(`deployment branches are ${report.environment.branchPolicies.join(',') || 'unrestricted'}, not main only`);
    const secrets = get(`repos/${repo}/environments/${ENVIRONMENT}/secrets?per_page=100`);
    if (secrets.ok) report.environmentSecrets = (secrets.data.secrets ?? []).map(secret => ({name: secret.name, updatedAt: secret.updated_at}));
    else report.notes.push(`environment secret names unreadable (${unreadableNote(secrets)})`);
  }
  const repoSecrets = get(`repos/${repo}/actions/secrets?per_page=100`);
  if (repoSecrets.ok) report.repositorySecrets = (repoSecrets.data.secrets ?? []).map(secret => ({name: secret.name, updatedAt: secret.updated_at}));
  else report.notes.push(`repository secret names unreadable (${unreadableNote(repoSecrets)})`);
  const envNames = new Set((report.environmentSecrets ?? []).map(secret => secret.name));
  if (report.environmentSecrets) {
    report.missing = expected.filter(name => !envNames.has(name));
    report.unexpected = [...envNames].filter(name => /^ALPHA_RELEASE_/.test(name) && !expected.includes(name));
  }
  report.atRepositoryLevel = (report.repositorySecrets ?? []).map(secret => secret.name).filter(name => /^ALPHA_RELEASE_/.test(name));
  if (report.atRepositoryLevel.length) report.notes.push(`release secrets stored at repository level, readable by every workflow: ${report.atRepositoryLevel.join(', ')}`);
  return report;
}

function print(local, remote) {
  const lines = [];
  lines.push(`Release signing readiness (read-only; not signing, build, image or device evidence)`);
  lines.push(`  H-09 enrollment: ${local.enrolled ? 'release signer recorded' : 'android/release-signer.json signerSha256 is unset'}`);
  lines.push(`  draft workflow ${DRAFT}: ${local.draft.present ? (local.draft.problems.length ? 'PROBLEMS' : 'safety rules hold') : 'missing'}`);
  for (const problem of local.draft.problems) lines.push(`    - ${problem}`);
  lines.push(`  enabled workflows reading release secrets: ${local.enabledWorkflows.join(', ') || 'none (draft not enabled)'}`);
  const labels = Object.entries(local.keyStorageLabels).filter(([, storage]) => storage !== 'offline-encrypted');
  lines.push(`  key manifest storage labels other than offline-encrypted: ${labels.map(([name, storage]) => `${name}=${storage}`).join(', ') || 'none'}`);
  lines.push(`  expected ${local.expectedSecrets.length} secrets in environment "${ENVIRONMENT}": ${local.expectedSecrets.join(', ')}`);
  if (remote) {
    lines.push(`  remote ${remote.repo} (GET only):`);
    if (remote.environment) {
      const e = remote.environment;
      lines.push(`    environment ${ENVIRONMENT}: reviewers ${e.requiredReviewers.join(', ') || 'none'}; prevent self-review ${e.preventSelfReview}; branches ${Array.isArray(e.branchPolicies) ? e.branchPolicies.join(', ') || 'unrestricted' : e.branchPolicies}; admins bypass ${e.canAdminsBypass}`);
    }
    if (remote.environmentSecrets) lines.push(`    environment secret names: ${remote.environmentSecrets.map(secret => secret.name).join(', ') || 'none'}`);
    if (remote.environmentSecrets) lines.push(`    missing: ${remote.missing.join(', ') || 'none'}; unexpected ALPHA_RELEASE_*: ${remote.unexpected.join(', ') || 'none'}`);
    lines.push(`    repository-level ALPHA_RELEASE_* secrets: ${remote.atRepositoryLevel.join(', ') || 'none'}`);
    for (const note of remote.notes) lines.push(`    note: ${note}`);
  }
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2), {flags: ['--remote', '--json'], options: ['--repo']});
  const local = localReport();
  const remote = args.remote ? remoteReport(args.repo ?? 'eliza-research/alphaphone', local.expectedSecrets) : null;
  console.log(args.json ? JSON.stringify({local, remote}, null, 2) : print(local, remote));
  process.exitCode = local.draft.problems.length ? 1 : 0;
}
