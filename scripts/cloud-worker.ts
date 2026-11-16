#!/usr/bin/env bun
/**
 * Alpha Cloud: the product's own Cloud, described by data this repository owns and built from the
 * pinned upstream source (vendor/eliza at upstream.lock.json, exported, never edited). No route
 * code lives here except the tiny web-host Worker in cloud/edge.
 *
 * Topology (docs/alpha-cloud.md): the upstream Cloud API Worker (inference, voice, account,
 * entitlements, subscriptions, Stripe webhooks, Maps, Google connector), the upstream Steward
 * login Worker and container (email code and Google sign-in), and cloud/edge on the web host
 * (assetlinks.json, sign-in and checkout returns). Postgres through Hyperdrive, KV, R2 and an
 * Upstash-compatible Redis REST endpoint. Upstream's Pages app, speech and admission Workers are
 * not deployed: the API Worker hosts their Durable Objects itself.
 *
 *   bun scripts/cloud-worker.ts prepare  [--tree DIR]                     export, install, build the pin
 *   bun scripts/cloud-worker.ts deployment                                 print the upstream deployment file
 *   bun scripts/cloud-worker.ts render   --out DIR [--tree DIR]           render every Worker configuration
 *   bun scripts/cloud-worker.ts check    --out DIR [--tree DIR]           render and bundle (dry run, no network)
 *   bun scripts/cloud-worker.ts registration --environment ENV            print the app's registration rows
 *   bun scripts/cloud-worker.ts secrets  --environment ENV --env-file F [--apply] [--frozen]   complete, verify, push
 *   bun scripts/cloud-worker.ts provision --environment ENV --env-file F [--write]  KV, R2, Hyperdrive, DNS
 *   bun scripts/cloud-worker.ts preflight --environment ENV [--env-file F] check live resource ownership before writes
 *   bun scripts/cloud-worker.ts database-identity --environment ENV --env-file F   read redacted database receipts
 *   bun scripts/cloud-worker.ts migrate  --environment ENV --env-file F   apply the Cloud database migrations
 *   bun scripts/cloud-worker.ts seed     --environment ENV --env-file F   register the app (apps + client rows)
 *   bun scripts/cloud-worker.ts deploy   --environment ENV --env-file F [--component api|login|edge|all]
 *   bun scripts/cloud-worker.ts tenant   --environment ENV --env-file F   create the Steward tenant (after deploy)
 *   bun scripts/cloud-worker.ts smoke    --environment ENV                public, credential-free readiness probe
 *
 * --policy (default cloud/policy.json) holds the Cloud's public identity: the same `production` and
 * `staging` rows the app is built with, so app and Cloud cannot name different authorities.
 * --resources (default cloud/resources.json) holds Cloudflare account and resource ids. Secrets
 * never enter either file: --env-file names a private file (mode 0600, outside the checkout) of
 * NAME=value lines. `secrets` fills in every internally generated secret once and refuses until
 * the operator-provided ones (docs/alpha-cloud.md) are present.
 */
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {nativeAuthCallbackRegistration, validateCloudDeployment, type CloudDeploymentConfig} from './cloud-deployment.ts';
import {registrationRows, seedRegistration, readIdentity, releaseSignerFingerprints, type CloudDatabaseAuthority} from './cloud-registration.ts';
import {cloudEnvironments, type CloudEnvironment} from './cloud-sdk-authority.ts';
import {leakedElizaHost} from './local-cloud.ts';
import {provisionedId, reconcileCloudResources, writeProvisionedResources} from './cloud-provision.ts';
import {publishedAssetLinksCheck} from './render-assetlinks.ts';
import {PLAN_KEYS, parsePlans} from '../apps/app/src/runtime/cloud-plans.ts';
import {parseCloudServiceInfo} from '../apps/app/src/runtime/cloud-service-info.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const identity = readIdentity(root);

export interface CloudResources {
  workerName: string; accountId: string; zone: string; blobHost: string; loginApiUrl: string; mailFrom: string;
  hyperdriveId: string; kvNamespaceId: string; r2Bucket: string; rateLimitNamespaceIds: Record<string, string>;
}

const SERVICE_DOCUMENT_BINDINGS = ['CLOUD_PUBLIC_SERVICE_TERMS_JSON', 'CLOUD_PUBLIC_SERVICE_PRIVACY_JSON'] as const;
const DATABASE_RECEIPTS = ['DATABASE_IDENTITY_EXPECTED_CLUSTER_SHA256', 'DATABASE_IDENTITY_EXPECTED_AUTHORITY_SHA256'] as const;

/** Values the operator supplies, including the approved public documents. */
export const OPERATOR_SECRETS = Object.freeze({
  required: ['DATABASE_URL', 'STEWARD_DATABASE_URL', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'CEREBRAS_API_KEY', 'RESEND_API_KEY',
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PLUS_MONTHLY_PRICE_ID', 'STRIPE_PLUS_PRODUCT_ID', 'STRIPE_PRO_MONTHLY_PRICE_ID', 'STRIPE_PRO_PRODUCT_ID', ...SERVICE_DOCUMENT_BINDINGS, ...DATABASE_RECEIPTS],
  optional: ['CARTESIA_API_KEY', 'CARTESIA_STT_USD_PER_CREDIT', 'OPENROUTER_API_KEY', 'GOOGLE_MAPS_API_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STEWARD_GOOGLE_NATIVE_CLIENT_IDS'],
});
/** Secrets this tool generates once and keeps in the env file. */
export const GENERATED_SECRETS = Object.freeze(['STEWARD_JWT_SECRET', 'STEWARD_MASTER_PASSWORD', 'STEWARD_KDF_SALT', 'STEWARD_AUDIT_HMAC_KEY',
  'STEWARD_RATE_LIMIT_TOKEN', 'STEWARD_AGGREGATION_TOKEN', 'STEWARD_SPEND_METRICS_TOKEN', 'STEWARD_REQUEST_SIGNING_SECRET',
  'STEWARD_PLATFORM_KEYS', 'STEWARD_PLATFORM_KEY_SCOPES', 'SECRETS_MASTER_KEY', 'CRON_SECRET',
  'ELIZA_ENTITLEMENT_SIGNING_KEY', 'ELIZA_ENTITLEMENT_SIGNING_KEY_ID', 'ELIZA_SUBSCRIPTION_GRANT_CODE_PEPPER']);

/** Which secret each Worker receives, and from which env-file name (login reads Steward's own database). */
export const WORKER_SECRETS = Object.freeze(['DATABASE_URL', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'STEWARD_JWT_SECRET', 'STEWARD_REQUEST_SIGNING_SECRET',
  'SECRETS_MASTER_KEY', 'CRON_SECRET', 'ELIZA_ENTITLEMENT_SIGNING_KEY', 'ELIZA_ENTITLEMENT_SIGNING_KEY_ID', 'ELIZA_SUBSCRIPTION_GRANT_CODE_PEPPER',
  'CEREBRAS_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PLUS_MONTHLY_PRICE_ID', 'STRIPE_PLUS_PRODUCT_ID', 'STRIPE_PRO_MONTHLY_PRICE_ID', 'STRIPE_PRO_PRODUCT_ID',
  'CARTESIA_API_KEY', 'CARTESIA_STT_USD_PER_CREDIT', 'OPENROUTER_API_KEY', 'GOOGLE_MAPS_API_KEY', 'STRIPE_PUBLISHABLE_KEY', ...SERVICE_DOCUMENT_BINDINGS]);
export const LOGIN_SECRETS = Object.freeze(['DATABASE_URL', 'STEWARD_MASTER_PASSWORD', 'STEWARD_JWT_SECRET', 'STEWARD_KDF_SALT', 'STEWARD_AUDIT_HMAC_KEY',
  'STEWARD_RATE_LIMIT_TOKEN', 'STEWARD_AGGREGATION_TOKEN', 'STEWARD_SPEND_METRICS_TOKEN', 'STEWARD_REQUEST_SIGNING_SECRET',
  'STEWARD_PLATFORM_KEYS', 'STEWARD_PLATFORM_KEY_SCOPES', 'RESEND_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'STEWARD_GOOGLE_NATIVE_CLIENT_IDS']);
const LOGIN_SECRET_SOURCE: Readonly<Record<string, string>> = {DATABASE_URL: 'STEWARD_DATABASE_URL'};
export const CLOUD_COMPONENTS = ['api', 'login', 'edge'] as const;
export type CloudComponent = typeof CLOUD_COMPONENTS[number];
const PLATFORM_SCOPES = ['platform:read', 'platform:write', 'platform:tenant:create', 'platform:tenant-join-mode:write'];

const loadJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;
const say = (message: string) => console.log(`[cloud] ${message}`);

export function deployResources(policy: CloudDeploymentConfig, resources: Record<CloudEnvironment, CloudResources>, environment: CloudEnvironment, env = process.env) {
  workerDeployment(policy, resources);
  const ids = resources[environment];
  for (const field of ['accountId', 'hyperdriveId', 'kvNamespaceId'] as const) {
    if (!provisionedId(ids[field])) throw new Error(`resources.${environment}.${field} is not provisioned; run provision before deploy`);
  }
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_ACCOUNT_ID !== ids.accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID does not match the selected resources');
  if (!env.CLOUDFLARE_API_TOKEN?.trim()) throw new Error('CLOUDFLARE_API_TOKEN is required to deploy Alpha Cloud');
  return ids;
}

/** The upstream deployment file: identity from the app's policy, ids from the operator. */
export function workerDeployment(policy: CloudDeploymentConfig, resources: Record<CloudEnvironment, CloudResources>) {
  validateCloudDeployment(policy);
  // The operator continues to deploy Alpha Cloud after phones adopt its storage namespace.
  const leak = leakedElizaHost(policy) ?? leakedElizaHost(resources);
  if (leak) throw new Error(`The product Cloud must not name ${leak}`);
  const environments = Object.fromEntries(cloudEnvironments.map(environment => {
    const row = policy[environment], ids = resources?.[environment];
    if (!ids) throw new Error(`No resources for ${environment}`);
    for (const key of ['workerName', 'accountId', 'zone', 'blobHost', 'loginApiUrl', 'mailFrom', 'hyperdriveId', 'kvNamespaceId', 'r2Bucket'] as const)
      if (typeof ids[key] !== 'string' || !ids[key].trim()) throw new Error(`resources.${environment}.${key} is required`);
    const zoned = (host: string) => { if (host !== ids.zone && !host.endsWith('.' + ids.zone)) throw new Error(`${host} is not in zone ${ids.zone}`); return {pattern: `${host}/*`, zone: ids.zone}; };
    zoned(new URL(row.web).host); zoned(new URL(row.services).host); zoned(new URL(ids.loginApiUrl).host);
    const callback = row.web + '/alphaphone/auth/callback';
    return [environment, {
      workerName: ids.workerName, accountId: ids.accountId,
      routes: [zoned(new URL(row.api).host), zoned(ids.blobHost)],
      origins: {web: row.web, app: row.services, api: row.api},
      tenantId: row.tenant, serviceName: row.name ?? new URL(row.api).hostname,
      blobHost: ids.blobHost, assetsBase: `https://${ids.blobHost}`, mailFrom: ids.mailFrom,
      // Upstream's hosted billing page is not deployed: plans are managed in the app. Cloud still
      // names this address in a few server messages, so it is the product's own host.
      billingUrl: `${row.services}/cloud/billing`,
      entitlement: {issuer: row.api, audience: row.entitlementAudience ?? 'cloud-subscription'},
      resources: {hyperdriveId: ids.hyperdriveId, kvNamespaceId: ids.kvNamespaceId, r2Bucket: ids.r2Bucket, rateLimitNamespaceIds: ids.rateLimitNamespaceIds},
      vars: {LOGIN_API_URL: ids.loginApiUrl, ELIZA_MOBILE_APP_AUTH_ENABLED: 'true', CACHE_ENABLED: 'true', CACHE_BACKEND: 'auto',
        DIRECT_REDIS_BACKEND: 'redis-rest', VOICE_SPEECH_RELAY_ENABLED: 'true', STEWARD_API_URL: ids.loginApiUrl},
      secrets: [...WORKER_SECRETS],
      components: {
        // Steward: every identity default it would otherwise take from upstream is set here.
        login: {workerName: `${ids.workerName}-login`, host: new URL(ids.loginApiUrl).host, enabled: true, container: {maxInstances: 1, instanceType: 'standard-1'},
          // APP_URL is Steward's own public origin: its Google redirect (APP_URL/auth/oauth/google/callback),
          // identity-token issuer and SIWE domain. The web host serves only the app's returns (cloud/edge).
          vars: {APP_URL: ids.loginApiUrl, EMAIL_FROM: ids.mailFrom, EMAIL_BRAND_NAME: row.name ?? identity.appName, EMAIL_AUTH_REDIRECT_BASE_URL: row.web,
            PASSKEY_RP_ID: new URL(row.web).hostname, PASSKEY_ORIGIN: row.web, STEWARD_DEFAULT_TENANT_ID: row.tenant,
            // Browser Google sign-in returns only to the app's registered callback.
            STEWARD_OAUTH_ALLOWED_REDIRECTS: callback, STEWARD_OAUTH_APP_ERROR_REDIRECTS: callback},
          secrets: [...LOGIN_SECRETS]},
      },
    }];
  }));
  return {id: `${identity.slug}-cloud`, environments};
}

/** The web-host Worker (cloud/edge/worker.ts): its own name, the web host as a custom domain, a binding to the API. */
export function edgeConfig(policy: CloudDeploymentConfig, resources: Record<CloudEnvironment, CloudResources>, environment: CloudEnvironment, out: string) {
  const row = validateCloudDeployment(policy)[environment], ids = resources[environment];
  return {
    $schema: 'node_modules/wrangler/config-schema.json',
    name: `${ids.workerName}-edge`, account_id: ids.accountId,
    main: path.relative(out, path.join(root, 'cloud/edge/worker.ts')),
    compatibility_date: '2026-11-01', workers_dev: false, preview_urls: false,
    routes: [{pattern: new URL(row.web).host, custom_domain: true}],
    services: [{binding: 'API', service: ids.workerName}],
    observability: {enabled: true},
  };
}

/** Resolve an output's existing ancestors before checking the immutable submodule boundary. */
export function outsideVendor(directory: string): string {
  const absolute = path.resolve(directory);
  let parent = absolute;
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  const resolved = path.join(fs.realpathSync(parent), path.relative(parent, absolute));
  const vendor = path.join(fs.realpathSync(root), 'vendor');
  const physicalVendor = fs.existsSync(vendor) ? fs.realpathSync(vendor) : vendor;
  const inside = (file: string, parent: string) => file === parent || file.startsWith(parent + path.sep);
  if (inside(absolute, path.join(root, 'vendor')) || inside(resolved, vendor) || inside(resolved, physicalVendor)) {
    throw new Error('Cloud tool inputs and outputs must be outside the pinned vendor checkout');
  }
  return resolved;
}

// ---------------------------------------------------------------------------------------------
// The pinned upstream tree.

const lock = () => loadJson<{commit: string}>(path.join(root, 'upstream.lock.json'));
export const defaultTree = () => path.join(process.env.ALPHA_CLOUD_TREE_ROOT ?? path.join(os.homedir(), '.cache/alphaphone-cloud'), lock().commit.slice(0, 12));

/** The Bun the tree pins (`packageManager`), never whatever happens to be on PATH. */
export function pinnedBun(tree: string): string {
  const wanted = /^bun@(\d+\.\d+\.\d+)$/.exec(loadJson<{packageManager?: string}>(path.join(tree, 'package.json')).packageManager ?? '')?.[1];
  if (!wanted) throw new Error(`${tree}/package.json pins no bun version`);
  const candidates = [process.env.BUN, path.join(os.homedir(), '.bun/bin/bun'), path.join(os.homedir(), `.local/share/mise/installs/bun/${wanted}/bin/bun`),
    ...String(process.env.PATH).split(path.delimiter).map(entry => path.join(entry, 'bun'))];
  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    const version = spawnSync(candidate, ['--version'], {encoding: 'utf8'}).stdout?.trim();
    if (version === wanted) return candidate;
  }
  throw new Error(`Bun ${wanted} (the pin's packageManager) is required: install it (for example \`mise install bun@${wanted}\`) or set BUN`);
}

const marker = (tree: string) => path.join(tree, '.alpha-cloud-tree.json');
interface PreparedTreeRecord { commit: string; built: boolean }

function treeRecord(tree: string): PreparedTreeRecord | null {
  const entry = fs.lstatSync(tree, {throwIfNoEntry: false});
  if (!entry) return null;
  if (entry.isDirectory()) {
    const record = marker(tree);
    if (fs.lstatSync(record, {throwIfNoEntry: false})?.isFile() && !fs.lstatSync(path.join(tree, '.git'), {throwIfNoEntry: false})) {
      try {
        const value = loadJson<PreparedTreeRecord>(record);
        if (typeof value?.commit === 'string' && /^[0-9a-f]{40}$/.test(value.commit) && typeof value.built === 'boolean') return value;
      } catch { /* An unreadable marker does not establish ownership. */ }
    }
    if (fs.readdirSync(tree).length === 0) return null;
  }
  throw new Error(`Existing directory ${tree} is not an Alpha Cloud export; choose an empty --tree`);
}

export function preparedTree(tree = defaultTree()) {
  tree = outsideVendor(tree);
  const record = treeRecord(tree);
  if (!record?.built || record.commit !== lock().commit) throw new Error(`No prepared upstream tree at ${tree} for ${lock().commit.slice(0, 10)}: run \`bun scripts/cloud-worker.ts prepare\``);
  return tree;
}

export async function prepare(tree = defaultTree()) {
  tree = outsideVendor(tree);
  const {commit} = lock(), vendor = path.join(root, 'vendor/eliza');
  const current = treeRecord(tree);
  if (current?.built && current.commit === commit) { say(`tree ready: ${tree}`); return tree; }

  const parent = path.dirname(tree);
  fs.mkdirSync(parent, {recursive: true});
  const scratch = fs.mkdtempSync(path.join(parent, '.alpha-cloud-prepare-'));
  const next = path.join(scratch, 'next'), previous = path.join(scratch, 'previous');
  let preservePrevious = false;
  try {
    fs.mkdirSync(next);
    say(`exporting the pinned upstream ${commit.slice(0, 10)} (git archive; vendor/eliza is not written)`);
    const exported = spawnSync('bash', ['-o', 'pipefail', '-c', 'git -C "$1" archive --format=tar "$2" | tar -x -C "$3"', 'export', vendor, commit, next], {stdio: 'inherit'});
    if (exported.status !== 0) throw new Error('git archive of the pin failed');
    const bun = pinnedBun(next);
    const run = (args: string[], label: string) => {
      say(label);
      const result = spawnSync(bun, args, {cwd: next, stdio: 'inherit', env: {...process.env, CI: '1', NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=8192`.trim()}});
      if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status})`);
    };
    run(['install', '--ignore-scripts'], 'installing the workspace (lifecycle scripts skipped)');
    run(['run', 'build:core'], 'building the workspace packages the Workers import (build:core)');
    fs.writeFileSync(marker(next), JSON.stringify({commit, built: true}) + '\n', {flag: 'wx'});

    const latest = treeRecord(tree);
    if (!latest?.built || latest.commit !== commit) {
      if (latest) fs.renameSync(tree, previous);
      try {
        fs.renameSync(next, tree);
      } catch (error) {
        if (latest) {
          try { fs.renameSync(previous, tree); }
          catch {
            preservePrevious = true;
            throw new Error(`Could not publish ${tree}; the previous export remains at ${previous}`, {cause: error});
          }
        }
        throw error;
      }
    }
  } finally {
    if (!preservePrevious) fs.rmSync(scratch, {recursive: true, force: true});
  }
  say(`tree ready: ${tree}`);
  return tree;
}

// ---------------------------------------------------------------------------------------------
// Rendering.

export const configFile = (out: string, component: CloudComponent, environment: CloudEnvironment) =>
  path.join(out, component === 'api' ? `wrangler.${environment}.jsonc` : `wrangler.${component}.${environment}.jsonc`);

export function render({policy, resources, tree, out, environments = cloudEnvironments}: {policy: CloudDeploymentConfig; resources: Record<CloudEnvironment, CloudResources>; tree: string; out: string; environments?: readonly CloudEnvironment[]}) {
  const deployment = workerDeployment(policy, resources);
  const bun = pinnedBun(tree), cli = path.join(tree, 'packages/cloud/deploy/src/cli.ts');
  if (!fs.existsSync(cli)) throw new Error(`${tree} has no packages/cloud/deploy`);
  fs.mkdirSync(out, {recursive: true});
  const file = path.join(out, 'deployment.json');
  fs.writeFileSync(file, JSON.stringify(deployment, null, 1) + '\n');
  for (const environment of environments) {
    const rendered = spawnSync(bun, [cli, 'render', '--deployment', file, '--environment', environment, '--component', 'all', '--upstream', tree, '--out', out], {stdio: ['ignore', 'ignore', 'inherit']});
    if (rendered.status !== 0) throw new Error(`upstream render failed for ${environment}`);
    fs.writeFileSync(configFile(out, 'edge', environment), JSON.stringify(edgeConfig(policy, resources, environment, out), null, 1) + '\n');
    for (const component of CLOUD_COMPONENTS) {
      const config = configFile(out, component, environment);
      if (!fs.existsSync(config)) throw new Error(`${config} was not rendered`);
      const leak = leakedElizaHost(fs.readFileSync(config, 'utf8'));
      if (leak) throw new Error(`${config} names ${leak}`);
    }
  }
  return out;
}

const wranglerIn = (tree: string) => {
  for (const candidate of [path.join(tree, 'packages/cloud/api/node_modules/.bin/wrangler'), path.join(tree, 'node_modules/.bin/wrangler')]) if (fs.existsSync(candidate)) return candidate;
  throw new Error(`No wrangler installed in ${tree}`);
};

export function check({tree, out, environments = cloudEnvironments}: {tree: string; out: string; environments?: readonly CloudEnvironment[]}) {
  const bun = pinnedBun(tree), cli = path.join(tree, 'packages/cloud/deploy/src/cli.ts');
  for (const environment of environments) for (const component of CLOUD_COMPONENTS) {
    const config = configFile(out, component, environment);
    const result = component === 'edge'
      ? spawnSync(wranglerIn(tree), ['deploy', '--dry-run', '--config', config, '--outdir', path.join(out, `edge-${environment}`)], {cwd: out, stdio: 'inherit'})
      : spawnSync(bun, [cli, 'check', '--config', config], {stdio: 'inherit'});
    if (result.status !== 0) throw new Error(`check failed: ${component} (${environment})`);
    say(`checked ${component} (${environment})`);
  }
}

// ---------------------------------------------------------------------------------------------
// Secrets: a private NAME=value file outside the checkout.

export function readEnvFile(file: string): Record<string, string> {
  const resolved = path.resolve(file);
  if (resolved.startsWith(root + path.sep)) throw new Error('The secrets file must live outside the checkout');
  if (!fs.existsSync(resolved)) return {};
  const stat = fs.statSync(resolved);
  if ((stat.mode & 0o077) !== 0) throw new Error(`${resolved} must be private (chmod 600)`);
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(resolved, 'utf8').split('\n')) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function writeEnvFile(file: string, values: Record<string, string>) {
  const text = Object.entries(values).map(([name, value]) => {
    if (/[\r\n]/.test(value)) throw new Error(`${name} cannot span lines`);
    return `${name}=${value}`;
  }).join('\n') + '\n';
  fs.writeFileSync(file, text, {mode: 0o600});
  fs.chmodSync(file, 0o600);
}

/** Fill every generated secret that is absent; existing values are kept so re-running never rotates. */
export function completeSecrets(values: Record<string, string>, environment: CloudEnvironment): Record<string, string> {
  const random = () => crypto.randomBytes(32).toString('hex');
  const next = {...values};
  const fill = (name: string, make: () => string) => { if (!next[name]) next[name] = make(); };
  for (const name of ['STEWARD_JWT_SECRET', 'STEWARD_MASTER_PASSWORD', 'STEWARD_KDF_SALT', 'STEWARD_AUDIT_HMAC_KEY', 'STEWARD_RATE_LIMIT_TOKEN',
    'STEWARD_AGGREGATION_TOKEN', 'STEWARD_SPEND_METRICS_TOKEN', 'STEWARD_REQUEST_SIGNING_SECRET', 'SECRETS_MASTER_KEY', 'CRON_SECRET', 'ELIZA_SUBSCRIPTION_GRANT_CODE_PEPPER']) fill(name, random);
  fill('STEWARD_PLATFORM_KEYS', () => `stw_platform_${random()}`);
  // Scopes are keyed by the key's SHA-256, so the scope document itself carries no key.
  const platformHash = crypto.createHash('sha256').update(next.STEWARD_PLATFORM_KEYS.split(',')[0].trim()).digest('hex');
  next.STEWARD_PLATFORM_KEY_SCOPES = JSON.stringify({[platformHash]: PLATFORM_SCOPES});
  // Cloud signs subscription entitlements with its own P-256 key (base64 PKCS#8); the app verifies them.
  fill('ELIZA_ENTITLEMENT_SIGNING_KEY', () => crypto.generateKeyPairSync('ec', {namedCurve: 'P-256'}).privateKey.export({type: 'pkcs8', format: 'der'}).toString('base64'));
  fill('ELIZA_ENTITLEMENT_SIGNING_KEY_ID', () => `alpha-${environment}-${new Date().toISOString().slice(0, 10)}`);
  return next;
}

export function secretProblems(values: Record<string, string>, environment: CloudEnvironment): string[] {
  const problems = OPERATOR_SECRETS.required.filter(name => !values[name]).map(name => `${name} is missing`);
  for (const name of [...OPERATOR_SECRETS.required, ...OPERATOR_SECRETS.optional, ...GENERATED_SECRETS]) {
    const value = values[name];
    if (value && leakedElizaHost(value)) problems.push(`${name} names ${leakedElizaHost(value)}`);
  }
  const stripe = values.STRIPE_SECRET_KEY;
  if (stripe && environment === 'production' && !/^(sk|rk)_live_/.test(stripe)) problems.push('STRIPE_SECRET_KEY must be a live key in production');
  if (stripe && environment === 'staging' && !/^(sk|rk)_test_/.test(stripe)) problems.push('STRIPE_SECRET_KEY must be a test key in staging');
  for (const name of ['DATABASE_URL', 'STEWARD_DATABASE_URL']) if (values[name] && !/^postgres(ql)?:\/\//.test(values[name])) problems.push(`${name} must be a postgres:// URL`);
  for (const name of DATABASE_RECEIPTS) if (values[name] && !validDatabaseReceipt(values[name])) problems.push(`${name} must be a lowercase SHA-256 digest`);
  if (values.DATABASE_URL && values.DATABASE_URL === values.STEWARD_DATABASE_URL) problems.push('STEWARD_DATABASE_URL must be a separate database from DATABASE_URL');
  if (values.KV_REST_API_URL && !/^https:\/\//.test(values.KV_REST_API_URL)) problems.push('KV_REST_API_URL must be https');
  if (values.STEWARD_GOOGLE_NATIVE_CLIENT_IDS) { try { JSON.parse(values.STEWARD_GOOGLE_NATIVE_CLIENT_IDS); } catch { problems.push('STEWARD_GOOGLE_NATIVE_CLIENT_IDS must be JSON'); } }
  for (const name of SERVICE_DOCUMENT_BINDINGS) {
    const value = values[name];
    if (!value) continue;
    if (Buffer.byteLength(value, 'utf8') > 5120) {
      problems.push(`${name} must be at most 5120 UTF-8 bytes`);
      continue;
    }
    try {
      const document = JSON.parse(value);
      parseCloudServiceInfo({success: true, version: 1, service: {name: identity.appName, terms: document, privacy: document}});
    } catch { problems.push(`${name} must be a JSON document with a title, revision and plain-text sections`); }
  }
  return problems;
}

export function componentSecrets(values: Record<string, string>, component: 'api' | 'login'): Record<string, string> {
  const names = component === 'api' ? WORKER_SECRETS : LOGIN_SECRETS;
  const source = component === 'login' ? LOGIN_SECRET_SOURCE : {};
  return Object.fromEntries(names.map(name => [name, values[source[name] ?? name]]).filter(([, value]) => value));
}

// ---------------------------------------------------------------------------------------------
// Worker deployment and secret upload use Wrangler from the prepared tree.

function wrangler(tree: string, args: string[], {input, cwd, accountId}: {input?: string; cwd?: string; accountId?: string} = {}) {
  const result = spawnSync(wranglerIn(tree), args, {cwd: cwd ?? tree, input, encoding: 'utf8', stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'],
    env: {...process.env, ...(accountId ? {CLOUDFLARE_ACCOUNT_ID: accountId} : {}), WRANGLER_SEND_METRICS: 'false'}});
  if (result.status !== 0) throw new Error(`wrangler ${args.slice(0, 3).join(' ')} failed`);
}

// ---------------------------------------------------------------------------------------------
// Database.

const validDatabaseReceipt = (value: string | undefined) => !!value && /^[a-f0-9]{64}$/.test(value);

function cloudDatabaseUrl(values: Record<string, string>): string {
  const url = values.DATABASE_URL;
  if (!url || !/^postgres(ql)?:\/\//.test(url) || !URL.canParse(url)) throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  return url;
}

export function databaseAuthority(values: Record<string, string>, environment: CloudEnvironment): CloudDatabaseAuthority {
  const [clusterName, authorityName] = DATABASE_RECEIPTS;
  for (const name of DATABASE_RECEIPTS) {
    if (!validDatabaseReceipt(values[name])) throw new Error(`${name} must be a reviewed lowercase SHA-256 digest`);
  }
  return {
    DATABASE_IDENTITY_GATE_MODE: 'enforce', DATABASE_IDENTITY_ENVIRONMENT: environment,
    [clusterName]: values[clusterName], [authorityName]: values[authorityName],
  };
}

export function reportDatabaseIdentity(tree: string, values: Record<string, string>, environment: CloudEnvironment) {
  const databaseUrl = cloudDatabaseUrl(values);
  const script = path.join(tree, 'packages/cloud/scripts/admin/preflight-database-identity.ts');
  const result = spawnSync(pinnedBun(tree), ['--conditions=eliza-source', script], {cwd: path.join(tree, 'packages/cloud/shared'), stdio: 'inherit', env: {
    ...process.env, DATABASE_URL: databaseUrl, DATABASE_IDENTITY_ENVIRONMENT: environment, DATABASE_IDENTITY_GATE_MODE: 'report',
    DATABASE_IDENTITY_EXPECTED_CLUSTER_SHA256: undefined, DATABASE_IDENTITY_EXPECTED_AUTHORITY_SHA256: undefined}});
  if (result.status !== 0) throw new Error('Could not read the database identity receipt');
}

export function migrate(tree: string, values: Record<string, string>, environment: CloudEnvironment) {
  const databaseUrl = cloudDatabaseUrl(values);
  const authority = databaseAuthority(values, environment);
  const result = spawnSync(pinnedBun(tree), ['run', '--cwd', 'packages/cloud/shared', 'db:migrate'], {cwd: tree,
    stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', env: {
    ...process.env, DATABASE_URL: databaseUrl, ...authority}});
  process.stdout.write(result.stdout ?? '');
  if (result.status !== 0) throw new Error('Cloud database migration failed');
  // The pinned migrator returns zero when it intentionally pauses before a compatibility barrier.
  if (!result.stdout.split(/\r?\n/).includes('[db:migrate] migrations complete')) {
    throw new Error('The pinned migrator did not confirm completion; resolve its release barrier before seeding or deploying');
  }
}

// ---------------------------------------------------------------------------------------------
// Public readiness: what the phone needs, without credentials.

export async function smoke(policy: CloudDeploymentConfig, resources: Record<CloudEnvironment, CloudResources>, environment: CloudEnvironment, fetchImpl: typeof fetch = fetch) {
  const row = validateCloudDeployment(policy)[environment], ids = resources[environment];
  const {redirectUri} = nativeAuthCallbackRegistration(policy, identity, environment);
  const registration = new URLSearchParams({clientId: identity.appId, environment, redirectUri});
  const rows: {gate: string; passed: boolean; detail: string}[] = [];
  const probe = async (gate: string, url: string, test: (response: Response, text: string) => string | null) => {
    try {
      const response = await fetchImpl(url, {redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: {'cache-control': 'no-cache'}});
      const text = await response.text();
      const leak = leakedElizaHost(text) ?? leakedElizaHost(response.headers.get('location'));
      const problem = response.status === 200 ? test(response, text) ?? (leak ? `names ${leak}` : null) : `HTTP ${response.status}`;
      rows.push({gate, passed: !problem, detail: problem ?? `HTTP ${response.status}`});
    } catch (error) { rows.push({gate, passed: false, detail: (error as Error).message}); }
  };
  const json = (text: string) => { try { return JSON.parse(text); } catch { return null; } };
  await probe('api health', `${row.api}/api/health`, (_response, text) => {
    const health = json(text);
    return health?.status === 'ok' && health.environment === environment ? null : `expected API health for ${environment}`;
  });
  await probe('service document', `${row.api}/api/public/service`, (_response, text) => {
    try {
      const service = parseCloudServiceInfo(json(text));
      return service.name === (row.name ?? new URL(row.api).hostname) ? null : 'unexpected Cloud service name';
    } catch { return 'expected Terms and Privacy documents accepted by Alpha sign-in'; }
  });
  await probe('entitlement keys', `${row.api}/api/v1/subscription/entitlement-keys`, (_response, text) => {
    const keys: unknown = json(text)?.keys;
    const usable = Array.isArray(keys) && keys.length > 0 && keys.every(key => {
      if (key?.kty !== 'EC' || key.crv !== 'P-256' || typeof key.kid !== 'string' || !key.kid.trim() || key.d !== undefined
        || typeof key.x !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key.x)
        || typeof key.y !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key.y)) return false;
      try { crypto.createPublicKey({key, format: 'jwk'}); return true; } catch { return false; }
    });
    return usable ? null : 'expected a nonempty set of public P-256 entitlement keys';
  });
  await probe('app registration', `${row.api}/api/v1/app-auth/mobile/config?${registration}`, (_response, text) => {
    const config = json(text);
    return config?.success === true && config.clientId === identity.appId && config.environment === environment
      && config.redirectUri === redirectUri && config.codeChallengeMethod === 'S256' ? null : 'expected the exact native client, callback and S256';
  });
  await probe('plans', `${row.api}/api/v1/subscriptions/plans`, (_response, text) => {
    try {
      const body = json(text);
      if (body?.success === true) {
        const plans = parsePlans(body);
        if (plans.length === PLAN_KEYS.length && PLAN_KEYS.every(key => plans.some(plan => plan.key === key))) return null;
      }
    } catch { /* The server catalogue must be usable by Alpha. */ }
    return 'expected the Plus and Pro subscription plans';
  });
  await probe('sign-in providers', `${ids.loginApiUrl}/auth/providers?tenantId=${encodeURIComponent(row.tenant)}`, (_response, text) => {
    const providers = json(text);
    return providers?.email === true && providers.google === true ? null : 'expected email and Google sign-in';
  });
  await probe('asset links', `${row.web}/.well-known/assetlinks.json`, (response, text) => {
    if (!/^application\/json\b/i.test(response.headers.get('content-type') ?? '')) return 'not application/json';
    const signerSha256 = releaseSignerFingerprints()[0].replaceAll(':', '').toLowerCase();
    const links = publishedAssetLinksCheck(text, {packageName: identity.appId, signerSha256});
    return links.granted ? null : links.problems.join('; ');
  });
  const callback = new URL(redirectUri);
  const callbackIntent = `intent://${callback.host}${callback.pathname}#Intent;scheme=https;package=${identity.appId};end`;
  await probe('callback page', redirectUri, (response, text) => /^text\/html\b/i.test(response.headers.get('content-type') ?? '')
    && text.includes(`href="${callbackIntent}"`) ? null : 'expected the hosted HTML callback for this Android package');
  return rows;
}

// ---------------------------------------------------------------------------------------------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {values: o, positionals} = parseArgs({allowPositionals: true, options: {
    policy: {type: 'string', default: path.join(root, 'cloud/policy.json')}, resources: {type: 'string', default: path.join(root, 'cloud/resources.json')},
    tree: {type: 'string'}, out: {type: 'string'}, environment: {type: 'string'}, 'env-file': {type: 'string'}, component: {type: 'string', default: 'all'},
    apply: {type: 'boolean', default: false}, frozen: {type: 'boolean', default: false}, write: {type: 'boolean', default: false}, json: {type: 'boolean', default: false}}});
  const command = positionals[0];
  const usage = () => { console.error('Usage: bun scripts/cloud-worker.ts prepare|deployment|render|check|registration|secrets|provision|preflight|database-identity|migrate|seed|deploy|tenant|smoke [options] (see the header of this file)'); process.exit(2); };
  const environment = () => { const value = o.environment as CloudEnvironment; if (!cloudEnvironments.includes(value)) usage(); return value; };
  const envFile = () => { if (!o['env-file']) usage(); return path.resolve(o['env-file']!); };
  const policy = () => loadJson<CloudDeploymentConfig>(o.policy!);
  const resources = () => loadJson<Record<CloudEnvironment, CloudResources>>(o.resources!);
  const out = () => outsideVendor(o.out ?? path.join(defaultTree(), '..', `render-${lock().commit.slice(0, 12)}`));
  const reconcile = (cloud: CloudDeploymentConfig, configured: Record<CloudEnvironment, CloudResources>, env: CloudEnvironment, databaseUrl?: string, create = false) =>
    reconcileCloudResources({ids: configured[env], sibling: configured[env === 'staging' ? 'production' : 'staging'], apiHost: new URL(cloud[env].api).host,
      databaseUrl, accountId: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN, create});
  try {
    switch (command) {
      case 'prepare': await prepare(o.tree ? path.resolve(o.tree) : undefined); break;
      case 'deployment': console.log(JSON.stringify(workerDeployment(policy(), resources()), null, 1)); break;
      case 'render': case 'check': {
        out();
        const tree = preparedTree(o.tree ? path.resolve(o.tree) : undefined);
        const directory = render({policy: policy(), resources: resources(), tree, out: out(), environments: o.environment ? [environment()] : cloudEnvironments});
        if (command === 'check') check({tree, out: directory, environments: o.environment ? [environment()] : cloudEnvironments});
        say(`${command === 'check' ? 'Rendered and bundled (dry run, nothing deployed)' : 'Rendered'}: ${directory}`);
        break;
      }
      case 'registration': console.log(JSON.stringify(registrationRows(policy(), environment()), null, 1)); break;
      case 'secrets': {
        const env = environment(), file = envFile();
        const existing = readEnvFile(file), values = completeSecrets(existing, env);
        // CI holds a completed file: generating there would rotate every internal secret on each run.
        if (o.frozen) { const absent = GENERATED_SECRETS.filter(name => !existing[name]); if (absent.length) throw new Error(`Generated secrets are absent (${absent.join(', ')}); run \`secrets\` once locally and store the completed file`); }
        else writeEnvFile(file, values);
        const problems = secretProblems(values, env);
        for (const name of OPERATOR_SECRETS.required) say(`${values[name] ? 'set    ' : 'MISSING'} ${name}`);
        for (const name of OPERATOR_SECRETS.optional) say(`${values[name] ? 'set    ' : 'unset  '} ${name} (optional)`);
        say(`generated: ${GENERATED_SECRETS.length} internal secrets kept in ${file}`);
        if (problems.length) { for (const problem of problems) console.error(`  - ${problem}`); process.exit(1); }
        if (o.apply) {
          const tree = preparedTree(o.tree ? path.resolve(o.tree) : undefined), directory = render({policy: policy(), resources: resources(), tree, out: out(), environments: [env]});
          for (const component of ['api', 'login'] as const) {
            wrangler(tree, ['secret', 'bulk', '--config', configFile(directory, component, env)], {input: JSON.stringify(componentSecrets(values, component)), cwd: directory, accountId: resources()[env].accountId});
            say(`pushed ${Object.keys(componentSecrets(values, component)).length} secrets to ${component}`);
          }
        }
        break;
      }
      case 'provision': {
        const env = environment(), targetPolicy = policy(), configured = resources();
        const writePath = o.write ? outsideVendor(o.resources!) : undefined;
        workerDeployment(targetPolicy, configured);
        const verified = await reconcile(targetPolicy, configured, env, readEnvFile(envFile()).DATABASE_URL, true);
        if (writePath) {
          writeProvisionedResources(writePath, env, configured[env], verified);
          say(`wrote ${o.resources}`);
        } else console.log(JSON.stringify(verified, null, 1));
        break;
      }
      case 'preflight': {
        const env = environment(), targetPolicy = policy(), targetResources = resources();
        deployResources(targetPolicy, targetResources, env);
        const databaseUrl = o['env-file'] ? readEnvFile(envFile()).DATABASE_URL : undefined;
        if (o['env-file'] && !databaseUrl) throw new Error('DATABASE_URL is missing from the env file');
        await reconcile(targetPolicy, targetResources, env, databaseUrl);
        say(`Cloudflare resource ownership verified for ${env}`);
        break;
      }
      case 'database-identity': case 'migrate': {
        const env = environment(), tree = preparedTree(o.tree ? path.resolve(o.tree) : undefined), values = readEnvFile(envFile());
        const operation = command === 'migrate' ? migrate : reportDatabaseIdentity;
        operation(tree, values, env);
        break;
      }
      case 'seed': {
        const env = environment(), values = readEnvFile(envFile()), tree = preparedTree(o.tree ? path.resolve(o.tree) : undefined);
        const databaseUrl = cloudDatabaseUrl(values), authority = databaseAuthority(values, env);
        console.log(JSON.stringify(seedRegistration({tree, databaseUrl, authority, rows: [registrationRows(policy(), env)], bun: pinnedBun(tree)})));
        break;
      }
      case 'deploy': {
        const env = environment(), targetPolicy = policy(), targetResources = resources();
        const ids = deployResources(targetPolicy, targetResources, env);
        const tree = preparedTree(o.tree ? path.resolve(o.tree) : undefined);
        const values = readEnvFile(envFile());
        const problems = [...secretProblems(values, env), ...GENERATED_SECRETS.filter(name => !values[name]).map(name => `${name} is missing`)];
        if (problems.length) throw new Error(`Secrets incomplete; run \`secrets\` first:\n  ${problems.join('\n  ')}`);
        await reconcile(targetPolicy, targetResources, env, values.DATABASE_URL);
        const directory = render({policy: targetPolicy, resources: targetResources, tree, out: out(), environments: [env]});
        const components = o.component === 'all' ? CLOUD_COMPONENTS : [o.component as CloudComponent];
        if (!components.every(component => CLOUD_COMPONENTS.includes(component))) usage();
        // API first: the edge Worker's service binding needs it to exist.
        // Each Worker's secrets travel with its version (--secrets-file): a first deploy never runs
        // without them, and no separate push can fall out of step. The file is private and removed.
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-cloud-secrets-'));
        try {
          for (const component of components) {
            say(`deploying ${component} (${env})`);
            const args = ['deploy', '--config', configFile(directory, component, env)];
            if (component !== 'edge') {
              const file = path.join(scratch, `${component}.json`);
              fs.writeFileSync(file, JSON.stringify(componentSecrets(values, component)), {mode: 0o600});
              args.push('--secrets-file', file);
            }
            wrangler(tree, args, {cwd: directory, accountId: ids.accountId});
          }
        } finally { fs.rmSync(scratch, {recursive: true, force: true}); }
        break;
      }
      case 'tenant': {
        const env = environment(), values = readEnvFile(envFile()), row = validateCloudDeployment(policy())[env], ids = resources()[env];
        const headers = {'Content-Type': 'application/json', 'X-Steward-Platform-Key': values.STEWARD_PLATFORM_KEYS?.split(',')[0] ?? ''};
        const created = await fetch(`${ids.loginApiUrl}/platform/tenants`, {method: 'POST', redirect: 'error', headers, body: JSON.stringify({id: row.tenant, name: row.name ?? identity.appName})});
        if (!created.ok && created.status !== 409) throw new Error(`Steward tenant creation failed (HTTP ${created.status}: ${(await created.text()).slice(0, 200)})`);
        const join = await fetch(`${ids.loginApiUrl}/platform/tenants/${row.tenant}/join-mode`, {method: 'PATCH', redirect: 'error', headers, body: JSON.stringify({joinMode: 'open'})});
        if (!join.ok) throw new Error(`Steward join mode failed (HTTP ${join.status})`);
        say(`tenant ${row.tenant} ${created.status === 409 ? 'already existed' : 'created'}; open sign-up enabled`);
        break;
      }
      case 'smoke': {
        const rows = await smoke(policy(), resources(), environment());
        if (o.json) console.log(JSON.stringify(rows, null, 1));
        else for (const row of rows) console.log(`${row.passed ? 'PASS' : 'FAIL'}  ${row.gate.padEnd(18)} ${row.detail}`);
        process.exit(rows.every(row => row.passed) ? 0 : 1);
      }
      default: usage();
    }
  } catch (error) {
    console.error(`[cloud] ${(error as Error).message}`);
    process.exit(1);
  }
}
