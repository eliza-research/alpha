#!/usr/bin/env node
/**
 * The product's own Cloud API Worker, described by data this repository owns and built from
 * upstream source. No route code lives here.
 *
 *   bun scripts/cloud-worker.ts deployment --policy FILE --resources FILE
 *   bun scripts/cloud-worker.ts render --policy FILE --resources FILE --upstream DIR [--tree DIR] --out DIR
 *   bun scripts/cloud-worker.ts check  --policy FILE --resources FILE --upstream DIR [--tree DIR] --out DIR
 *
 * --policy     the Cloud's public identity: the same `production` and `staging` rows the app is built
 *              with (scripts/cloud-deployment-policy.ts, ALPHA_CLOUD_DEPLOYMENT_FILE). The app and its
 *              Cloud therefore cannot name different authorities.
 * --resources  the operator's Cloudflare account, zone and resource ids (cloud/resources.example.json).
 *              Identifiers only; secrets are set on the Worker and appear here by name alone.
 * --upstream   an upstream checkout that carries packages/cloud/deploy (never vendor/eliza edits).
 * --packages   instead of --upstream: a directory whose node_modules holds the installed Cloud packages
 *              (@elizaos/cloud-api, @elizaos/cloud-deploy). The API Worker is then built from cloud/worker.ts
 *              with nothing resolved from an upstream checkout; the other components still need --upstream.
 * --tree       an installed upstream tree to bundle from, when it is not --upstream.
 *
 * `render` writes the configuration of every component (API, login, speech, admission, web) and the
 * lists of secret names. `check` also bundles each
 * Worker with `wrangler deploy --dry-run`: no network, nothing deployed. Neither is a deployed
 * Cloud, and the shipped Eliza Cloud policy is refused: this builds the product's Cloud only.
 */
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {storageFingerprint, STORAGE_NAMESPACES, validateCloudDeployment, nativeAuthCallbackRegistration, type CloudDeploymentConfig} from './cloud-deployment.ts';
import {cloudEnvironments, type CloudEnvironment} from './cloud-sdk-authority.ts';
import {leakedElizaHost} from './local-cloud.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const identity = JSON.parse(fs.readFileSync(path.join(root, 'app.config.json'), 'utf8')) as {slug: string; appId: string; appName: string};

export interface CloudResources {
  workerName: string; accountId: string; zone: string; blobHost: string; loginApiUrl: string; mailFrom: string;
  hyperdriveId: string; kvNamespaceId: string; r2Bucket: string; rateLimitNamespaceIds: Record<string, string>;
}
/** Secrets the product's Worker needs, by name. Values are set on the Worker by the operator, never stored here. */
export const WORKER_SECRETS = Object.freeze(['DATABASE_URL', 'STEWARD_JWT_SECRET', 'STEWARD_REQUEST_SIGNING_SECRET', 'STEWARD_PLATFORM_KEYS', 'STEWARD_TENANT_API_KEY', 'SECRETS_MASTER_KEY', 'CRON_SECRET',
  'ELIZA_ENTITLEMENT_SIGNING_KEY', 'ELIZA_ENTITLEMENT_SIGNING_KEY_ID', 'ELIZA_SUBSCRIPTION_GRANT_CODE_PEPPER', 'ELIZA_MOBILE_APP_AUTH_CLIENTS_JSON', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_MAPS_API_KEY']);

export const LOGIN_SECRETS = Object.freeze(['DATABASE_URL', 'STEWARD_MASTER_PASSWORD', 'STEWARD_JWT_SECRET', 'STEWARD_KDF_SALT', 'STEWARD_AUDIT_HMAC_KEY', 'STEWARD_RATE_LIMIT_TOKEN',
  'STEWARD_AGGREGATION_TOKEN', 'STEWARD_SPEND_METRICS_TOKEN', 'STEWARD_REQUEST_SIGNING_SECRET', 'RESEND_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'STEWARD_GOOGLE_NATIVE_CLIENT_IDS']);
export const SPEECH_SECRETS = Object.freeze(['CARTESIA_API_KEY', 'CARTESIA_STT_USD_PER_CREDIT', 'DATABASE_URL', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']);
export const CLOUD_COMPONENTS = ['api', 'login', 'speech', 'admission', 'web'] as const;

/** The upstream deployment file for this product: identity from the app's policy, ids from the operator. */
export function workerDeployment(policy: CloudDeploymentConfig, resources: Record<CloudEnvironment, CloudResources>) {
  validateCloudDeployment(policy);
  if (STORAGE_NAMESPACES.includes(storageFingerprint(policy))) throw new Error('This policy is a shipped Cloud deployment; the product Worker is built only for the product\'s own Cloud');
  const leak = leakedElizaHost(policy) ?? leakedElizaHost(resources);
  if (leak) throw new Error(`The product Cloud must not name ${leak}`);
  const environments = Object.fromEntries(cloudEnvironments.map(environment => {
    const row = policy[environment], ids = resources?.[environment];
    if (!ids) throw new Error(`No resources for ${environment}`);
    for (const key of ['workerName', 'accountId', 'zone', 'blobHost', 'loginApiUrl', 'mailFrom', 'hyperdriveId', 'kvNamespaceId', 'r2Bucket'] as const)
      if (typeof ids[key] !== 'string' || !ids[key].trim()) throw new Error(`resources.${environment}.${key} is required`);
    const zoned = (host: string) => { if (host !== ids.zone && !host.endsWith('.' + ids.zone)) throw new Error(`${host} is not in zone ${ids.zone}`); return {pattern: `${host}/*`, zone: ids.zone}; };
    const callback = nativeAuthCallbackRegistration(policy, identity, environment);
    return [environment, {
      workerName: ids.workerName, accountId: ids.accountId,
      routes: [zoned(new URL(row.api).host), zoned(ids.blobHost)],
      origins: {web: row.web, app: row.services, api: row.api},
      tenantId: row.tenant, serviceName: row.name ?? new URL(row.api).hostname,
      blobHost: ids.blobHost, assetsBase: `https://${ids.blobHost}`, mailFrom: ids.mailFrom,
      // The page the app opens for plans (cloud-protocol.ts): the services origin's billing page.
      billingUrl: `${row.services}/cloud/billing`,
      entitlement: {issuer: row.api, audience: row.entitlementAudience ?? 'cloud-subscription'},
      resources: {hyperdriveId: ids.hyperdriveId, kvNamespaceId: ids.kvNamespaceId, r2Bucket: ids.r2Bucket, rateLimitNamespaceIds: ids.rateLimitNamespaceIds},
      vars: {LOGIN_API_URL: ids.loginApiUrl, ELIZA_MOBILE_APP_AUTH_ENABLED: 'true', CACHE_ENABLED: 'true', CACHE_BACKEND: 'auto', VOICE_SPEECH_RELAY_ENABLED: 'true'},
      secrets: [...WORKER_SECRETS],
      // The admission gate lives in the product's own admission Worker, never another deployment's.
      durableObjectTransfers: {InferenceAdmissionGate: `${ids.workerName}-admission`},
      components: {
        // Steward: every identity default it would otherwise take from upstream is set here.
        login: {workerName: `${ids.workerName}-login`, host: new URL(ids.loginApiUrl).host, enabled: true, container: {maxInstances: 1, instanceType: 'standard-1'},
          vars: {APP_URL: row.web, EMAIL_FROM: ids.mailFrom, EMAIL_AUTH_REDIRECT_BASE_URL: row.web, PASSKEY_RP_ID: new URL(row.web).hostname, PASSKEY_ORIGIN: row.web, STEWARD_DEFAULT_TENANT_ID: row.tenant},
          secrets: [...LOGIN_SECRETS]},
        speech: {workerName: `${ids.workerName}-speech`, hostsSessions: true, vars: {CACHE_ENABLED: 'true', CACHE_BACKEND: 'auto', DIRECT_REDIS_BACKEND: 'redis-rest', VOICE_SPEECH_RELAY_ENABLED: 'true'}, secrets: [...SPEECH_SECRETS]},
        admission: {workerName: `${ids.workerName}-admission`, vars: {CACHE_ENABLED: 'true', CACHE_BACKEND: 'auto', VOICE_SPEECH_RELAY_ENABLED: 'true'}, secrets: []},
        // The web front end serves this app's sign-in return and browser-start pages.
        web: {projectName: `${ids.workerName}-web`, nativeAuthCallbacks: [callback]},
      },
    }];
  }));
  return {id: `${identity.slug}-cloud`, environments};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {values: o, positionals} = parseArgs({allowPositionals: true, options: {policy: {type: 'string'}, resources: {type: 'string'}, upstream: {type: 'string'}, packages: {type: 'string'}, tree: {type: 'string'}, out: {type: 'string'}}});
  const command = positionals[0];
  if (!['deployment', 'render', 'check'].includes(command) || !o.policy || !o.resources || (command !== 'deployment' && (!o.out || !o.upstream === !o.packages))) {
    console.error('Usage: bun scripts/cloud-worker.ts deployment|render|check --policy FILE --resources FILE [--upstream DIR [--tree DIR] | --packages DIR] --out DIR'); process.exit(2);
  }
  const deployment = workerDeployment(JSON.parse(fs.readFileSync(o.policy, 'utf8')), JSON.parse(fs.readFileSync(o.resources, 'utf8')));
  if (command === 'deployment') { console.log(JSON.stringify(deployment, null, 1)); process.exit(0); }
  const out = path.resolve(o.out!);
  const bun = [process.env.BUN, path.join(os.homedir(), '.bun/bin/bun'), ...String(process.env.PATH).split(path.delimiter).map(entry => path.join(entry, 'bun'))].find(candidate => candidate && fs.existsSync(candidate));
  if (!bun) throw new Error('bun is required (https://bun.sh)');
  if (o.packages) {
    // Installed packages: the product's thin entry is bundled with every input from that install.
    const packages = path.resolve(o.packages), tool = path.join(packages, 'node_modules/@elizaos/cloud-deploy/src/cli.ts');
    if (!fs.existsSync(tool)) throw new Error(`${packages} has no installed @elizaos/cloud-deploy`);
    if (out !== packages && !out.startsWith(packages + path.sep)) throw new Error('--out must be inside --packages so the Worker resolves the installed packages');
    fs.mkdirSync(out, {recursive: true});
    const entry = path.join(out, 'worker.ts'), deploymentFile = path.join(out, 'deployment.json');
    fs.copyFileSync(path.join(root, 'cloud/worker.ts'), entry);
    fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 1) + '\n');
    for (const environment of cloudEnvironments) {
      const rendered = spawnSync(bun, [tool, 'render', '--deployment', deploymentFile, '--environment', environment, '--packages', packages, '--main', entry, '--out', out], {stdio: 'inherit'});
      if (rendered.status !== 0) process.exit(rendered.status ?? 1);
      const config = path.join(out, `wrangler.${environment}.jsonc`);
      const leak = leakedElizaHost(fs.readFileSync(config, 'utf8'));
      if (leak) throw new Error(`${config} names ${leak}`);
      if (command === 'check') {
        const checked = spawnSync(bun, [tool, 'check', '--config', config], {stdio: 'inherit'});
        if (checked.status !== 0) { console.error(`check failed: api (${environment})`); process.exit(checked.status ?? 1); }
        console.log(`checked api from installed packages (${environment})`);
      }
    }
    console.log(`${command === 'check' ? 'Rendered and bundled from installed packages (dry run, nothing deployed)' : 'Rendered'}: ${out}`);
    process.exit(0);
  }
  const upstream = path.resolve(o.upstream!), tree = path.resolve(o.tree ?? o.upstream!);
  if (upstream.startsWith(path.join(root, 'vendor') + path.sep)) throw new Error('--upstream must be a separate checkout, not vendor/eliza');
  const cli = path.join(upstream, 'packages/cloud/deploy/src/cli.ts');
  if (!fs.existsSync(cli)) throw new Error(`${upstream} has no packages/cloud/deploy (an upstream revision with the deployment tool is required)`);
  fs.mkdirSync(out, {recursive: true});
  const file = path.join(out, 'deployment.json');
  fs.writeFileSync(file, JSON.stringify(deployment, null, 1) + '\n');
  for (const environment of cloudEnvironments) {
    const rendered = spawnSync(bun, [cli, 'render', '--deployment', file, '--environment', environment, '--component', 'all', '--upstream', tree, '--out', out], {stdio: 'inherit'});
    if (rendered.status !== 0) process.exit(rendered.status ?? 1);
    for (const component of CLOUD_COMPONENTS) {
      const config = path.join(out, component === 'api' ? `wrangler.${environment}.jsonc` : `wrangler.${component}.${environment}.jsonc`);
      if (!fs.existsSync(config)) throw new Error(`${config} was not rendered`);
      const leak = leakedElizaHost(fs.readFileSync(config, 'utf8'));
      if (leak) throw new Error(`${config} names ${leak}`);
      if (command === 'check') {
        const checked = spawnSync(bun, [cli, 'check', '--config', config], {stdio: 'inherit'});
        if (checked.status !== 0) { console.error(`check failed: ${component} (${environment})`); process.exit(checked.status ?? 1); }
        console.log(`checked ${component} (${environment})`);
      }
    }
  }
  console.log(`${command === 'check' ? 'Rendered and bundled (dry run, nothing deployed)' : 'Rendered'}: ${out}`);
}
