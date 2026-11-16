/**
 * Alpha Phone's native client registration on its own Cloud.
 *
 * Upstream Cloud reads native App Auth clients only from its database (`apps` plus
 * `mobile_app_auth_clients`, migration 0574): there is no deployment setting and no upstream
 * command that creates one. This module derives the two rows from the app's own identity
 * (app.config.json), the Cloud policy rows and the release signer, so the local Cloud and every
 * deployed environment register exactly the same client. `seedRegistration` applies them through
 * `scripts/cloud-seed-registration.ts`, which runs inside an installed upstream tree so that it
 * uses upstream's own `pg` driver.
 *
 * The same rows also produce `/.well-known/assetlinks.json` (upstream serves it from them), so
 * the Android App Link for the sign-in callback verifies against the release certificate.
 */
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CLOUD_SIGN_IN_REGISTRATION} from './cloud-deployment-policy.ts';
import {validateCloudDeployment, type CloudDeploymentConfig} from './cloud-deployment.ts';
import type {CloudEnvironment} from './cloud-sdk-authority.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED_SCRIPT = path.join(root, 'scripts/cloud-seed-registration.ts');

export interface AppIdentity { appId: string; appName: string; slug: string }
export interface CloudDatabaseAuthority {
  DATABASE_IDENTITY_ENVIRONMENT: CloudEnvironment;
  DATABASE_IDENTITY_GATE_MODE: 'enforce';
  DATABASE_IDENTITY_EXPECTED_CLUSTER_SHA256: string;
  DATABASE_IDENTITY_EXPECTED_AUTHORITY_SHA256: string;
}
export interface RegistrationRows {
  /** The owning organization (created on first seed when absent). */
  owner: {organizationSlug: string; organizationName: string; email: string};
  app: {id: string; name: string; slug: string; app_url: string; allowed_origins: string[]; is_active: true; is_approved: true};
  client: {
    client_id: string; app_id: string; redirect_uri: string; credential_ttl_seconds: null;
    android_package_name: string; callback_android_package: string;
    android_relations: string[]; android_cert_fingerprints: string[];
    browser_sign_in: {startPath: string; returnPath: string; storageKey: string; apiOrigin: string; tenant: string};
    enabled: true;
  };
}

export const readIdentity = (directory = root): AppIdentity => JSON.parse(fs.readFileSync(path.join(directory, 'app.config.json'), 'utf8'));

/** `AB:CD:…` as assetlinks.json and upstream's registry require. */
export function colonFingerprint(hex: string) {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('Signer fingerprints must be 64 lower-case hex characters');
  return hex.toUpperCase().replace(/(..)(?=.)/g, '$1:');
}

/** The release certificate and, while a rotation is approved, the previous one (installed phones still carry it). */
export function releaseSignerFingerprints(directory = root): string[] {
  const signer = JSON.parse(fs.readFileSync(path.join(directory, 'android/release-signer.json'), 'utf8')) as {signerSha256: string; apkSigningRotation?: {approval?: string; previousSignerSha256?: string}};
  const values = [signer.signerSha256];
  if (signer.apkSigningRotation?.approval === 'approved' && signer.apkSigningRotation.previousSignerSha256) values.push(signer.apkSigningRotation.previousSignerSha256);
  return [...new Set(values)].map(colonFingerprint);
}

/** A stable UUID for this app on one environment, so reseeding updates rather than duplicates. */
export function registrationAppId(identity: AppIdentity, environment: CloudEnvironment, api: string) {
  const hex = createHash('sha256').update(`alpha-cloud-app\0${identity.appId}\0${environment}\0${api}`).digest('hex');
  // RFC 4122 layout, version 5 style (name-based), variant 10.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface RegistrationTarget { api: string; web: string; tenant: string; name?: string }

/** Rows for one Cloud given its public authorities (also used by the loopback local Cloud). */
export function registrationFor(target: RegistrationTarget, environment: CloudEnvironment, {identity = readIdentity(), fingerprints = releaseSignerFingerprints(), extraFingerprints = [] as string[]} = {}): RegistrationRows {
  const redirect = target.web + CLOUD_SIGN_IN_REGISTRATION.callbackPath;
  const id = registrationAppId(identity, environment, target.api);
  const certificates = [...new Set([...fingerprints, ...extraFingerprints.map(value => /:/.test(value) ? value.toUpperCase() : colonFingerprint(value))])];
  const apiHost = new URL(target.api).hostname;
  return {
    owner: {organizationSlug: `${identity.slug}-apps`, organizationName: `${target.name ?? identity.appName} apps`, email: `apps@${/^[\d.]+$/.test(apiHost) ? 'localhost.invalid' : apiHost.split('.').slice(-2).join('.')}`},
    app: {id, name: identity.appName, slug: `${identity.slug}-${environment}`, app_url: target.web, allowed_origins: [redirect], is_active: true, is_approved: true},
    client: {
      client_id: identity.appId, app_id: id, redirect_uri: redirect, credential_ttl_seconds: null,
      android_package_name: identity.appId, callback_android_package: identity.appId,
      android_relations: ['delegate_permission/common.handle_all_urls'], android_cert_fingerprints: certificates,
      browser_sign_in: {...CLOUD_SIGN_IN_REGISTRATION.browserSignIn, apiOrigin: target.api, tenant: target.tenant},
      enabled: true,
    },
  };
}

export function registrationRows(policy: CloudDeploymentConfig, environment: CloudEnvironment, options: Parameters<typeof registrationFor>[2] = {}): RegistrationRows {
  return registrationFor(validateCloudDeployment(policy)[environment], environment, options);
}

/**
 * Upsert the rows into a Cloud database. `tree` is an installed upstream tree (its `pg` is used);
 * `databaseUrl` is the Cloud's Postgres (never logged). Returns the seed script's JSON report.
 */
export function seedRegistration({tree, databaseUrl, rows, bun, authority}: {tree: string; databaseUrl: string; rows: RegistrationRows[]; bun: string; authority?: CloudDatabaseAuthority}) {
  const result = spawnSync(bun, ['--conditions=eliza-source', SEED_SCRIPT], {cwd: path.join(tree, 'packages/cloud/shared'), encoding: 'utf8', stdio: ['ignore', 'pipe', authority ? 'pipe' : 'inherit'], env: {
    ...process.env, SEED_PACKAGE_JSON: path.join(tree, 'packages/cloud/shared/package.json'), SEED_DATABASE_URL: databaseUrl, SEED_ROWS: JSON.stringify(rows),
    SEED_DATABASE_AUTHORITY: authority ? JSON.stringify(authority) : undefined}});
  if (result.status !== 0) throw new Error('Seeding the app registration failed');
  return JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}');
}
