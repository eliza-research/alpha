#!/usr/bin/env node
/**
 * A standalone Cloud for Alpha Phone on this computer, built from the pinned vendor/eliza
 * source with Alpha's own identity. Development only; it never contacts a deployed Cloud.
 *
 *   node scripts/local-cloud.ts prepare [--dir DIR]         export the pin and install it
 *     --source REPO   export REPO's HEAD instead (an upstream branch under review; never vendor/eliza edits)
 *     --deployment-id ID   (start) run as a product deployment (upstream CLOUD_DEPLOYMENT_ID), which must
 *                          refuse to start or answer rather than fall back to any Eliza identity
 *   ELIZA_DEV_ALLOW_TEST_MOCKS=1 node scripts/local-cloud.ts start [--dir DIR] [--port 8787]
 *   node scripts/local-cloud.ts check [--dir DIR] [--json]  sign in and call the product routes
 *
 * What `start` runs, all on loopback (the Android emulator reaches it as 10.0.2.2):
 * - The pinned vendor/eliza commit, exported with `git archive` into DIR/eliza. The submodule
 *   checkout is never written or installed into.
 * - Steward (packages/auth embedded server) with in-memory PGlite and mock mail: emailed codes
 *   go to its loopback dev sink, never to a mailbox. Its tenant is LOCAL_CLOUD.tenant.
 * - The Cloud API worker (wrangler --local, PGlite), ENVIRONMENT=staging because Cloud's mobile
 *   App Auth knows only staging and production, with Alpha's client registered and its apps
 *   row seeded.
 * - One TLS front door: `/steward/*` to Steward, everything else to the API. Its certificate
 *   is made here; trust it with NODE_EXTRA_CA_CERTS.
 *
 * `check` is the evidence that the product's Cloud contract is served without eliza.app: it
 * performs an email-code sign-in for a throwaway address, mints and acknowledges a mobile
 * credential, reads the account, the entitlement keys and the service document, revokes the
 * credential, and fails if any answer names a deployed Eliza Cloud host. It is a local source
 * build result only: not a deployed Cloud, an APK, an emulator or a device result.
 */
import {execFileSync, spawn, spawnSync, type ChildProcess} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {CLOUD_SIGN_IN_REGISTRATION} from './cloud-deployment-policy.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = path.join(root, 'vendor/eliza');
const identity = JSON.parse(fs.readFileSync(path.join(root, 'app.config.json'), 'utf8')) as {appId: string; appName: string};

/** The local Cloud's own identity. Nothing here names Eliza's deployment or tenant. */
export const LOCAL_CLOUD = Object.freeze({tenant: 'alphacloud-local', name: 'Alpha Cloud (local)', pglitePort: 55443});
/** Hosts of deployed Eliza Clouds. A local answer that names one is a leaked dependency. */
export const DEPLOYED_ELIZA_HOST = /(?:^|[^a-z0-9-])((?:[a-z0-9-]+\.)*(?:eliza\.app|elizacloud\.ai))(?![a-z0-9.-])/i;

export const localCloudDirectory = (option?: string, env = process.env) =>
  path.resolve(option || env.ALPHA_LOCAL_CLOUD_DIR || path.join(os.homedir(), '.cache', 'alphaphone-local-cloud'));

/** The registration a Cloud operator enters for Alpha, for a Cloud whose web and API share `origin`. */
export function localRegistration(origin: string) {
  return {clientId: identity.appId, environment: 'staging', redirectUri: origin + CLOUD_SIGN_IN_REGISTRATION.callbackPath};
}

/** The first deployed Eliza host named anywhere in a JSON answer, or null. */
export function leakedElizaHost(value: unknown): string | null {
  const match = DEPLOYED_ELIZA_HOST.exec(typeof value === 'string' ? value : JSON.stringify(value ?? null));
  return match ? match[1].toLowerCase() : null;
}

function resolveBun() {
  for (const candidate of [process.env.BUN, path.join(os.homedir(), '.bun/bin/bun'), ...String(process.env.PATH).split(path.delimiter).map(entry => path.join(entry, 'bun'))])
    if (candidate && fs.existsSync(candidate)) return candidate;
  throw new Error('bun is required (https://bun.sh)');
}
const say = (message: string) => console.log(`[local-cloud] ${message}`);
const writePrivate = (file: string, text: string) => { fs.writeFileSync(file, text, {mode: 0o600}); fs.chmodSync(file, 0o600); };

interface Layout { source: string; deploymentId: string | null; dir: string; exportDir: string; front: string; ports: {front: number; steward: number; api: number; pglite: number} }
function layout(dirOption: string | undefined, portOption: string, sourceOption?: string, deploymentId?: string): Layout {
  const dir = localCloudDirectory(dirOption);
  if (dir === root || dir.startsWith(root + path.sep)) throw new Error('The local Cloud directory must be outside this checkout');
  const front = Number(portOption);
  if (!Number.isInteger(front) || front < 1024 || front > 65000) throw new Error('--port must be 1024–65000');
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  if (deploymentId !== undefined && !/^[a-z0-9-]{1,40}$/.test(deploymentId)) throw new Error('--deployment-id must match [a-z0-9-]');
  return {source: sourceOption ? path.resolve(sourceOption) : vendorDir, deploymentId: deploymentId ?? null, dir, exportDir: path.join(dir, 'eliza'), front: `https://127.0.0.1:${front}`, ports: {front, steward: front + 13, api: front + 1, pglite: LOCAL_CLOUD.pglitePort}};
}

async function prepare({dir, exportDir, source}: Layout) {
  const head = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  const commit = source === vendorDir ? JSON.parse(fs.readFileSync(path.join(root, 'upstream.lock.json'), 'utf8')).commit as string : head;
  if (head !== commit) throw new Error('vendor/eliza is not at the pinned commit (upstream.lock.json)');
  if (source !== vendorDir && execFileSync('git', ['-C', source, 'status', '--porcelain'], {encoding: 'utf8'}).trim()) throw new Error('--source has uncommitted changes; only a commit is exported');
  const marker = path.join(exportDir, '.alpha-export');
  if (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8').trim() !== commit) {
    say(`exporting ${source === vendorDir ? 'the pinned vendor/eliza' : source + ' at ' + commit.slice(0, 10)} (git archive; the checkout is not written)`);
    fs.rmSync(exportDir, {recursive: true, force: true});
    fs.mkdirSync(exportDir, {recursive: true});
    const archive = spawn('git', ['-C', source, 'archive', '--format=tar', commit], {stdio: ['ignore', 'pipe', 'inherit']});
    const extract = spawn('tar', ['-x', '-C', exportDir], {stdio: ['pipe', 'inherit', 'inherit']});
    archive.stdout.pipe(extract.stdin);
    const code = await new Promise(resolve => extract.on('close', resolve));
    if (code !== 0) throw new Error('Export failed');
    fs.writeFileSync(marker, commit + '\n');
  }
  say('installing the workspace into the export (lifecycle scripts skipped)');
  if (spawnSync(resolveBun(), ['install', '--ignore-scripts'], {cwd: exportDir, stdio: 'inherit', env: {...process.env, CI: '1'}}).status !== 0) throw new Error('bun install failed in the export');
  const links = path.join(exportDir, 'packages/scripts/ensure-workspace-symlinks.ts');
  if (fs.existsSync(links)) spawnSync(resolveBun(), [links], {cwd: exportDir, stdio: 'inherit'});
  // The Worker bundle imports some workspace packages from their built dist.
  const builds = path.join(exportDir, 'packages/scripts/build-private-workspace-packages.ts');
  if (fs.existsSync(builds) && spawnSync(resolveBun(), [builds], {cwd: exportDir, stdio: 'inherit'}).status !== 0) {
    // A package's post-build self-check can fail after its dist is written (the Worker bundle
    // does not use that entry). `start` is the proof; a missing dist fails there, loudly.
    for (const dist of ['packages/core/dist', 'plugins/plugin-elizacloud/dist', 'plugins/plugin-sql/dist'])
      if (!fs.existsSync(path.join(exportDir, dist))) throw new Error(`Building the workspace packages failed (${dist} is missing)`);
    say('WARNING: the workspace package build reported a failure; the dists the Cloud API imports exist, continuing');
  }
  // Dists the Worker bundle imports that the install-time build set does not include.
  const extra = ['plugin-google-workspace', 'plugin-todos', 'plugin-wallet'];
  spawnSync(process.execPath, [path.join(exportDir, 'packages/scripts/run-turbo.ts'), 'run', ...extra.map(name => `@elizaos/${name}#build`), '--continue'], {cwd: exportDir, stdio: 'inherit'});
  for (const name of extra) if (!fs.existsSync(path.join(exportDir, 'plugins', name, 'dist'))) throw new Error(`Building ${name} failed`);
  certificate(dir);
  say('prepared');
}

/** A self-signed development certificate for 127.0.0.1, localhost and 10.0.2.2. */
function certificate(dir: string) {
  const tls = path.join(dir, 'tls');
  fs.mkdirSync(tls, {recursive: true, mode: 0o700});
  const cert = path.join(tls, 'cert.pem'), key = path.join(tls, 'key.pem');
  if (!fs.existsSync(cert) || !fs.existsSync(key)) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-subj', '/CN=alpha-local-cloud',
      '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost,IP:10.0.2.2', '-addext', 'basicConstraints=critical,CA:TRUE', '-keyout', key, '-out', cert], {stdio: 'ignore'});
    fs.chmodSync(key, 0o600);
  }
  return {cert, key};
}

/** Secrets of this local Cloud only, made once and kept owner-only in DIR. */
function secrets(dir: string): Record<string, string> {
  const file = path.join(dir, 'secrets.json');
  const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string> : null;
  // Cloud signs subscription entitlements with its own P-256 key (base64 PKCS#8).
  const entitlementKey = () => crypto.generateKeyPairSync('ec', {namedCurve: 'P-256'}).privateKey.export({type: 'pkcs8', format: 'der'}).toString('base64');
  if (saved?.entitlementKey) return saved;
  if (saved) { const value = {...saved, entitlementKey: entitlementKey()}; writePrivate(file, JSON.stringify(value)); return value; }
  const random = () => crypto.randomBytes(32).toString('hex');
  const value = {entitlementKey: entitlementKey(), stewardMaster: random(), stewardJwt: random(), stewardKdf: random(), stewardAudit: random(), platformKey: `stw_platform_${random()}`, sessionSecret: random(),
    cronSecret: random(), reservedAppId: crypto.randomUUID(), alphaAppId: crypto.randomUUID(), localRootKey: crypto.randomBytes(32).toString('base64')};
  writePrivate(file, JSON.stringify(value));
  return value;
}

async function waitFor(url: string, {timeoutMs = 240000, child, ok = (response: Response) => response.status < 500}: {timeoutMs?: number; child?: ChildProcess; ok?: (response: Response) => boolean} = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (child && child.exitCode !== null) throw new Error(`A local Cloud process exited (${child.exitCode})`);
    try { const response = await fetch(url, {signal: AbortSignal.timeout(3000)}); if (ok(response)) return response; } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${new URL(url).pathname}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
const portFree = (port: number) => new Promise<boolean>(resolve => { const server = net.createServer().once('error', () => resolve(false)).once('listening', () => server.close(() => resolve(true))); server.listen(port, '127.0.0.1'); });

const started: ChildProcess[] = [];
const stopAll = () => { for (const child of started) if (child.exitCode === null) child.kill('SIGTERM'); };

/** A placeholder legal document for the local Cloud's sign-in screen; a deployed Cloud carries the real text. */
const legal = (title: string) => JSON.stringify({title: `${title} (local development)`, revision: 'local', sections: [{title, paragraphs: ['This local development Cloud has no legal text.']}]});

async function start({dir, exportDir, front, ports, deploymentId}: Layout) {
  if (process.env.ELIZA_DEV_ALLOW_TEST_MOCKS !== '1') throw new Error('The local Cloud uses mock mail and seeded rows: set ELIZA_DEV_ALLOW_TEST_MOCKS=1');
  if (!fs.existsSync(path.join(exportDir, 'node_modules'))) throw new Error('Run `prepare` first');
  for (const [name, port] of Object.entries(ports)) if (!await portFree(port)) throw new Error(`Port ${port} (${name}) is in use`);
  const s = secrets(dir);
  const {cert, key} = certificate(dir);
  const registration = localRegistration(front);
  const steward = `http://127.0.0.1:${ports.steward}`, api = `http://127.0.0.1:${ports.api}`;
  process.on('SIGINT', () => { stopAll(); process.exit(130); });
  process.on('SIGTERM', () => { stopAll(); process.exit(143); });
  const log = (name: string) => fs.openSync(path.join(dir, `${name}.log`), 'a', 0o600);

  // 1. Steward: embedded, in-memory, mock mail, Alpha's own tenant.
  const stewardProcess = spawn(resolveBun(), ['--conditions=eliza-source', path.join(exportDir, 'packages/auth/src/server/embedded.ts')], {cwd: exportDir, stdio: ['ignore', log('steward'), log('steward')], env: {
    ...process.env, TZ: 'UTC', NODE_ENV: 'test', PORT: String(ports.steward), LOGIN_BIND_HOST: '127.0.0.1', STEWARD_RUNTIME: 'bun', STEWARD_DB_MODE: 'pglite', STEWARD_PGLITE_MEMORY: 'true',
    STEWARD_MASTER_PASSWORD: s.stewardMaster, STEWARD_JWT_SECRET: s.stewardJwt, STEWARD_KDF_SALT: s.stewardKdf, STEWARD_AUDIT_HMAC_KEY: s.stewardAudit, STEWARD_PLATFORM_KEYS: s.platformKey,
    STEWARD_PLATFORM_KEY_SCOPES: JSON.stringify({[s.platformKey]: ['platform:read', 'platform:write', 'platform:tenant:create', 'platform:tenant-join-mode:write']}),
    EMAIL_PROVIDER: 'mock', SMS_PROVIDER: 'mock', STEWARD_DEFAULT_TENANT_ID: LOCAL_CLOUD.tenant, APP_URL: front, EMAIL_BRAND_NAME: LOCAL_CLOUD.name, EMAIL_FROM: 'login@alpha-local-cloud.invalid',
    REDIS_URL: '', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: ''}});
  started.push(stewardProcess);
  await waitFor(`${steward}/health`, {child: stewardProcess, ok: response => response.ok});
  const platform = {'Content-Type': 'application/json', 'X-Steward-Platform-Key': s.platformKey};
  const tenant = await fetch(`${steward}/platform/tenants`, {method: 'POST', headers: platform, body: JSON.stringify({id: LOCAL_CLOUD.tenant, name: LOCAL_CLOUD.name})});
  if (!tenant.ok && tenant.status !== 409) throw new Error(`Steward tenant setup failed (HTTP ${tenant.status}); see ${path.join(dir, 'steward.log')}`);
  const join = await fetch(`${steward}/platform/tenants/${LOCAL_CLOUD.tenant}/join-mode`, {method: 'PATCH', headers: platform, body: JSON.stringify({joinMode: 'open'})});
  if (!join.ok) throw new Error(`Steward tenant join mode failed (HTTP ${join.status}); see ${path.join(dir, 'steward.log')}`);
  say(`Steward up (tenant ${LOCAL_CLOUD.tenant})`);

  // 2. Cloud API: wrangler --local with PGlite, Alpha's client registered, every public origin this Cloud's own.
  const clients = JSON.stringify([{clientId: registration.clientId, appId: s.alphaAppId, redirectUri: registration.redirectUri, enabled: true}]);
  const vars: Record<string, string> = {
    ENVIRONMENT: 'staging', NODE_ENV: 'development',
    NEXT_PUBLIC_APP_URL: front, NEXT_PUBLIC_API_URL: front, ELIZA_CLOUD_URL: front, LOGIN_APP_URL: front, LOGIN_API_URL: `${front}/steward`,
    // Unset, upstream falls back to Eliza's public blob host: new accounts' default avatar URL named it (found by `check`).
    R2_PUBLIC_HOST: new URL(front).host, NEXT_PUBLIC_ASSETS_CDN_URL: front,
    STEWARD_API_URL: steward, STEWARD_TENANT_ID: LOCAL_CLOUD.tenant, STEWARD_DEFAULT_TENANT_ID: LOCAL_CLOUD.tenant, NEXT_PUBLIC_STEWARD_TENANT_ID: LOCAL_CLOUD.tenant,
    STEWARD_JWT_SECRET: s.stewardJwt, STEWARD_SESSION_SECRET: s.sessionSecret, CRON_SECRET: s.cronSecret, ELIZA_LOCAL_ROOT_KEY: s.localRootKey,
    ELIZA_MOBILE_APP_AUTH_ENABLED: 'true', ELIZA_MOBILE_APP_AUTH_APP_ID: s.reservedAppId, ELIZA_MOBILE_APP_AUTH_CLIENTS_JSON: clients,
    CLOUD_PUBLIC_SERVICE_NAME: LOCAL_CLOUD.name, CLOUD_PUBLIC_SERVICE_TERMS_JSON: legal('Terms'), CLOUD_PUBLIC_SERVICE_PRIVACY_JSON: legal('Privacy'),
    ELIZA_ENTITLEMENT_ISSUER: front, ELIZA_ENTITLEMENT_AUDIENCE: 'alpha-phone-local', ELIZA_ENTITLEMENT_SIGNING_KEY: s.entitlementKey, ELIZA_ENTITLEMENT_SIGNING_KEY_ID: 'alpha-local-1',
  };
  // An upstream build with a deployment identity: every value is this Cloud's own, and upstream must fail
  // closed on a missing one instead of using an Eliza default.
  const product: Record<string, string> = deploymentId ? {CLOUD_DEPLOYMENT_ID: deploymentId, CLOUD_WEB_ORIGIN: front, CLOUD_BILLING_URL: `${front}/cloud/billing`, SENDGRID_FROM_EMAIL: 'cloud@alpha-local-cloud.invalid'} : {};
  Object.assign(vars, product);
  // The launcher's sync step rewrites the Worker's dev vars from packages/cloud/shared/.env.local,
  // so the settings go into the EXPORT's file, never the checkout.
  for (const [name, value] of Object.entries(vars)) if (/[\r\n']/.test(value)) throw new Error(`${name} cannot be written to the local env file`);
  writePrivate(path.join(exportDir, 'packages/cloud/shared/.env.local'), Object.entries(vars).map(([name, value]) => `${name}='${value}'`).join('\n') + '\n');
  const devVars = path.join(dir, 'api.dev.vars');
  if (!fs.existsSync(devVars)) writePrivate(devVars, '');
  // wrangler.toml's committed [vars] carry Eliza's deployment identity: each one the mobile path
  // reads is overridden here, which is exactly the list a real deployment config must own.
  const override = ['ENVIRONMENT:staging', 'APP_BILLING_ENVIRONMENT:test', 'ELIZA_KMS_BACKEND:local', 'MOCK_REDIS:1', 'REDIS_RATE_LIMITING:true', 'NODE_ENV:development',
    `NEXT_PUBLIC_APP_URL:${front}`, `NEXT_PUBLIC_API_URL:${front}`, `ELIZA_CLOUD_URL:${front}`, `STEWARD_TENANT_ID:${LOCAL_CLOUD.tenant}`, `R2_PUBLIC_HOST:${new URL(front).host}`, `NEXT_PUBLIC_ASSETS_CDN_URL:${front}`,
    `ELIZA_ENTITLEMENT_ISSUER:${front}`, `ELIZA_ENTITLEMENT_AUDIENCE:${vars.ELIZA_ENTITLEMENT_AUDIENCE}`, `CLOUD_PUBLIC_SERVICE_NAME:${LOCAL_CLOUD.name}`,
    `ELIZA_MOBILE_APP_AUTH_APP_ID:${s.reservedAppId}`, `ELIZA_MOBILE_APP_AUTH_CLIENTS_JSON:${clients}`,
    `CLOUD_PUBLIC_SERVICE_TERMS_JSON:${vars.CLOUD_PUBLIC_SERVICE_TERMS_JSON}`, `CLOUD_PUBLIC_SERVICE_PRIVACY_JSON:${vars.CLOUD_PUBLIC_SERVICE_PRIVACY_JSON}`,
    `ELIZA_ENTITLEMENT_SIGNING_KEY:${s.entitlementKey}`, 'ELIZA_ENTITLEMENT_SIGNING_KEY_ID:alpha-local-1', ...Object.entries(product).map(([name, value]) => `${name}:${value}`)];
  const wranglerArgs = ['dev', '--ip', '127.0.0.1', '--port', String(ports.api), '--local', '--env-file', devVars, '--persist-to', path.join(dir, 'wrangler'), ...override.flatMap(value => ['--var', value])];
  const pgConf = path.join(dir, 'pgdata', 'postgresql.conf');
  if (fs.existsSync(pgConf)) fs.writeFileSync(pgConf, fs.readFileSync(pgConf, 'utf8').replace(/^(log_)?timezone = .*$/gm, (_line, prefix) => `${prefix ?? ''}timezone = 'UTC'`));
  const apiProcess = spawn(process.execPath, [path.join(exportDir, 'packages/cloud/scripts/admin/dev/cloud-api-dev.ts'), ...wranglerArgs], {cwd: path.join(exportDir, 'packages/cloud/api'), stdio: ['ignore', log('cloud-api'), log('cloud-api')], env: {
    ...process.env, TZ: 'UTC', API_DEV_PORT: String(ports.api), ELIZA_API_DEV_VARS_PATH: devVars, DEV_CLOUD_PGLITE_PORT: String(ports.pglite),
    DEV_CLOUD_PGLITE_DATA_DIR: path.join(dir, 'pgdata'), DEV_CLOUD_WRANGLER_PERSIST_TO: path.join(dir, 'wrangler'), DATABASE_URL: '', TEST_DATABASE_URL: ''}});
  started.push(apiProcess);
  await waitFor(`${api}/api/health`, {child: apiProcess, timeoutMs: 600000});
  seed({dir, exportDir, ports}, s, registration.redirectUri);
  say(`Cloud API up (client ${registration.clientId} registered)`);

  // 3. The TLS front door.
  const proxy = https.createServer({cert: fs.readFileSync(cert), key: fs.readFileSync(key)}, (req, res) => {
    const toSteward = req.url?.startsWith('/steward/');
    const port = toSteward ? ports.steward : ports.api;
    const upstream = http.request({host: '127.0.0.1', port, method: req.method, path: toSteward ? req.url!.slice('/steward'.length) : req.url,
      headers: {...req.headers, host: `127.0.0.1:${port}`, 'x-forwarded-proto': 'https'}}, response => { res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res); });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  await new Promise<void>(resolve => proxy.listen(ports.front, '127.0.0.1', resolve));
  writePrivate(path.join(dir, 'local-cloud.json'), JSON.stringify({api: front, web: front, steward, tenant: LOCAL_CLOUD.tenant, name: LOCAL_CLOUD.name, deploymentId, registration, caCertificate: cert}, null, 1));
  say(`ready at ${front}; description in ${path.join(dir, 'local-cloud.json')}`);
  say('check:  node scripts/local-cloud.ts check');
  say('Ctrl-C stops the local Cloud.');
}

/** The rows Cloud's mobile App Auth requires: an owner organization and user, and an approved app per registered client. */
function seed({dir, exportDir, ports}: Pick<Layout, 'dir' | 'exportDir' | 'ports'>, s: Record<string, string>, redirect: string) {
  const script = path.join(dir, 'seed.ts');
  fs.writeFileSync(script, `
import {createRequire} from "node:module";
const {Client} = createRequire(process.env.SEED_PACKAGE_JSON)("pg");
const database = new Client({connectionString: process.env.SEED_DATABASE_URL});
await database.connect();
const sql = async (text, values = []) => (await database.query(text, values)).rows;
const cols = async table => new Set((await sql("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1", [table])).map(r => r.column_name));
const insert = async (table, row, suffix = "") => {
  const keys = Object.keys(row);
  return sql('insert into "' + table + '" (' + keys.map(key => '"' + key + '"').join(', ') + ') values (' + keys.map((_, index) => '$' + (index + 1)).join(', ') + ') ' + suffix, Object.values(row));
};
const apps = await cols("apps");
if (!apps.size) throw new Error("apps table missing (migrations not applied)");
const users = await cols("users");
const email = 'owner@alpha-local-cloud.invalid';
let [user] = await sql("select id, organization_id from users where email = $1 limit 1", [email]);
if (!user) {
  const [org] = await sql("insert into organizations (name, slug) values ('Local apps', 'local-apps-' || substr(md5(random()::text), 1, 8)) returning id");
  [user] = await insert("users", {email, organization_id: org.id, role: 'owner', ...(users.has("steward_user_id") ? {steward_user_id: 'local-apps-owner-' + org.id} : {})}, "returning id, organization_id");
}
for (const [id, name, uri] of JSON.parse(process.env.SEED_APPS)) {
  await insert("apps", {id, name, organization_id: user.organization_id, ...(apps.has("created_by_user_id") ? {created_by_user_id: user.id} : {}),
    ...(apps.has("slug") ? {slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + id.slice(0, 8)} : {}),
    ...(apps.has("app_url") ? {app_url: new URL(uri).origin} : {}), ...(apps.has("allowed_origins") ? {allowed_origins: JSON.stringify([uri])} : {}),
    ...(apps.has("redirect_uris") ? {redirect_uris: [uri]} : {}), ...(apps.has("is_active") ? {is_active: true} : {}), ...(apps.has("is_approved") ? {is_approved: true} : {}),
    ...(apps.has("approval_status") ? {approval_status: "approved"} : {})}, "on conflict (id) do nothing");
}
await database.end();
`);
  // Upstream reserves its own first-party client and callback; its app row must exist for the registry to load.
  const apps = [[s.reservedAppId, 'Reserved upstream client (local)', 'https://reserved-upstream-client.invalid/auth/callback'], [s.alphaAppId, `${identity.appName} (local)`, redirect]];
  const result = spawnSync(resolveBun(), [script], {cwd: path.join(exportDir, 'packages/cloud/shared'), stdio: ['ignore', 'inherit', 'inherit'], env: {...process.env,
    SEED_PACKAGE_JSON: path.join(exportDir, 'package.json'), SEED_DATABASE_URL: `postgresql://postgres@127.0.0.1:${ports.pglite}/postgres`, SEED_APPS: JSON.stringify(apps)}});
  if (result.status !== 0) throw new Error('Seeding the local app rows failed');
}

export interface CheckRow { gate: string; passed: boolean; detail: string }

/** The product's Cloud contract against a local Cloud: one real sign-in and the routes behind it. */
export async function checkLocalCloud(cloud: {api: string; steward: string; tenant: string; registration: ReturnType<typeof localRegistration>}, fetchImpl: typeof fetch = fetch): Promise<CheckRow[]> {
  if (!['127.0.0.1', 'localhost'].includes(new URL(cloud.api).hostname)) throw new Error('Refusing: this check signs in and only runs against a Cloud on this computer');
  const rows: CheckRow[] = [];
  const leaks: string[] = [];
  const call = async (route: string, {method = 'GET', body, bearer, base = cloud.api}: {method?: string; body?: unknown; bearer?: string; base?: string} = {}) => {
    const response = await fetchImpl(base + route, {method, redirect: 'manual', signal: AbortSignal.timeout(60000),
      headers: {Accept: 'application/json', ...(body === undefined ? {} : {'Content-Type': 'application/json'}), ...(bearer ? {Authorization: `Bearer ${bearer}`} : {})}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    const text = await response.text();
    let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    const leak = leakedElizaHost(text) ?? leakedElizaHost(response.headers.get('location') ?? '');
    if (leak) leaks.push(`${method} ${route.split('?')[0]} names ${leak}`);
    return {status: response.status, data, location: response.headers.get('location')};
  };
  const row = (gate: string, passed: boolean, detail: string) => { rows.push({gate, passed, detail}); return passed; };
  const {clientId, environment, redirectUri} = cloud.registration;

  const config = await call(`/api/v1/app-auth/mobile/config?${new URLSearchParams({clientId, environment, redirectUri})}`);
  row('registration', config.status === 200, `mobile config for ${clientId}: HTTP ${config.status}`);
  const providers = await call(`/steward/auth/providers?tenantId=${encodeURIComponent(cloud.tenant)}`);
  row('sign-in methods', providers.status === 200 && providers.data?.email === true, `providers for tenant ${cloud.tenant}: HTTP ${providers.status}, email ${providers.data?.email === true ? 'offered' : 'not offered'}`);
  const keys = await call('/api/v1/subscription/entitlement-keys');
  row('entitlement keys', keys.status === 200, `HTTP ${keys.status}`);
  const service = await call('/api/public/service');
  row('service document', service.status === 200, `HTTP ${service.status}`);

  // One email-code sign-in for a throwaway address; the code is read from Steward's loopback dev sink.
  const email = `alpha-local-${crypto.randomBytes(4).toString('hex')}@example.com`;
  const emailVerifier = crypto.randomBytes(48).toString('base64url');
  const since = Date.now();
  const sent = await call('/steward/auth/email/code/send', {method: 'POST', body: {email, tenantId: cloud.tenant, client: clientId, pkce: {codeChallenge: crypto.createHash('sha256').update(emailVerifier).digest('base64url'), codeChallengeMethod: 'S256'}}});
  if (!row('email code sent', sent.status === 200, `HTTP ${sent.status}`)) return finish();
  let code: string | null = null;
  for (const deadline = Date.now() + 30000; !code && Date.now() < deadline; await new Promise(resolve => setTimeout(resolve, 500))) {
    const inbox = await call(`/auth/test/inbox/${encodeURIComponent(email)}`, {base: cloud.steward});
    const found = /\b(\d{6})\b/.exec(String(inbox.data?.code ?? inbox.data?.text ?? ''))?.[1];
    if (found && (!inbox.data?.sentAt || Date.parse(inbox.data.sentAt) >= since - 1000)) code = found;
  }
  if (!row('email code delivered', !!code, code ? 'read from the local mail sink' : 'no code reached the local mail sink')) return finish();
  const verified = await call('/steward/auth/email/code/verify', {method: 'POST', body: {email, code, tenantId: cloud.tenant, client: clientId, pkce: {codeVerifier: emailVerifier}}});
  const session = verified.data?.token ?? verified.data?.data?.token;
  if (!row('email code verified', verified.status === 200 && typeof session === 'string', `HTTP ${verified.status}`)) return finish();

  const verifier = crypto.randomBytes(48).toString('base64url'), state = crypto.randomBytes(32).toString('base64url');
  const binding = {clientId, environment, redirectUri};
  const connected = await call('/api/v1/app-auth/connect', {method: 'POST', bearer: session, body: {flow: 'mobile_pkce', ...binding, state,
    codeChallenge: crypto.createHash('sha256').update(verifier).digest('base64url'), codeChallengeMethod: 'S256', deviceName: 'Alpha Phone local Cloud check'}});
  if (!row('app authorization', connected.status === 200 && typeof connected.data?.code === 'string', `connect: HTTP ${connected.status}${connected.data?.error ? ` (${connected.data.error})` : ''}`)) return finish();
  const proof = {...binding, code: connected.data.code, state, codeVerifier: verifier};
  const minted = await call('/api/v1/app-auth/mobile/token', {method: 'POST', body: {...proof, grantType: 'authorization_code'}});
  const secret = minted.data?.secret, credentialId = minted.data?.credentialId;
  if (!row('credential minted', minted.status === 200 && typeof secret === 'string' && typeof credentialId === 'string', `token: HTTP ${minted.status}${minted.data?.error ? ` (${minted.data.error})` : ''}`)) return finish();
  const acked = await call('/api/v1/app-auth/mobile/ack', {method: 'POST', body: {...proof, credentialId, secret}});
  row('credential acknowledged', acked.status === 200 && acked.data?.status === 'acknowledged', `ack: HTTP ${acked.status}`);
  const user = await call('/api/v1/user', {bearer: secret});
  const who = user.data?.data ?? user.data;
  row('account read', user.status === 200 && typeof who?.id === 'string', `GET /api/v1/user: HTTP ${user.status}`);
  const entitlement = await call('/api/v1/subscription/entitlement', {bearer: secret});
  row('entitlement route', entitlement.status < 500 && entitlement.status !== 404, `HTTP ${entitlement.status} (a new account has no plan)`);
  const revoked = await call('/api/v1/api-keys/current', {method: 'DELETE', bearer: secret});
  row('credential revoked', revoked.status === 200 || revoked.status === 204, `DELETE /api/v1/api-keys/current: HTTP ${revoked.status}`);
  const after = await call('/api/v1/user', {bearer: secret});
  row('revocation enforced', after.status === 401, `GET /api/v1/user after revocation: HTTP ${after.status}`);
  return finish();

  function finish() {
    rows.push({gate: 'no deployed Eliza Cloud host', passed: leaks.length === 0, detail: leaks.length ? [...new Set(leaks)].join('; ') : 'no answer named eliza.app or elizacloud.ai'});
    return rows;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {values: options, positionals} = parseArgs({allowPositionals: true, options: {dir: {type: 'string'}, port: {type: 'string', default: '8787'}, source: {type: 'string'}, 'deployment-id': {type: 'string'}, json: {type: 'boolean', default: false}}});
  const command = positionals[0];
  if (!['prepare', 'start', 'check'].includes(command)) { console.error('Usage: node scripts/local-cloud.ts prepare|start|check [--dir DIR] [--port PORT] [--json]'); process.exit(2); }
  const paths = layout(options.dir, options.port!, options.source, options['deployment-id']);
  if (command === 'prepare') await prepare(paths);
  else if (command === 'start') { try { await start(paths); } catch (error) { stopAll(); throw error; } }
  else {
    const file = path.join(paths.dir, 'local-cloud.json');
    if (!fs.existsSync(file)) throw new Error(`No ${file}: start the local Cloud first`);
    const cloud = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Node reads NODE_EXTRA_CA_CERTS only at start-up: run again with the local certificate trusted.
    if (process.env.NODE_EXTRA_CA_CERTS !== cloud.caCertificate) {
      process.exit(spawnSync(process.execPath, process.argv.slice(1), {stdio: 'inherit', env: {...process.env, NODE_EXTRA_CA_CERTS: cloud.caCertificate}}).status ?? 1);
    }
    const rows = await checkLocalCloud(cloud);
    if (options.json) console.log(JSON.stringify(rows, null, 1));
    else for (const {gate, passed, detail} of rows) console.log(`${passed ? 'PASS' : 'FAIL'}  ${gate}: ${detail}`);
    process.exit(rows.every(entry => entry.passed) ? 0 : 1);
  }
}
