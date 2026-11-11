import fs from 'node:fs';

/** Installed sign-in routes and browser return namespace, owned by this consumer. */
export const CLOUD_SIGN_IN_REGISTRATION = Object.freeze({
  callbackPath: '/alphaphone/auth/callback',
  /** The Steward app client that carries Alpha's native Google client IDs (AlphaCloudSignInPlugin). */
  stewardAppClient: 'alpha-phone',
  browserSignIn: Object.freeze({
    startPath: '/alphaphone/auth/browser-start',
    returnPath: '/__alpha-browser-cloud/signin-return',
    storageKey: 'alpha-browser-sign-in:v1',
  }),
});

/**
 * The Cloud every distributed build uses. It stays Eliza Cloud until the product's own Cloud is
 * deployed and the cutover release changes these rows (with a storage namespace migration).
 */
export const SHIPPED_CLOUD_DEPLOYMENT = Object.freeze({
  production: Object.freeze({
    api: 'https://api.eliza.app',
    web: 'https://eliza.app',
    services: 'https://cloud.eliza.app',
    tenant: 'elizacloud',
    name: 'Eliza Cloud',
    entitlementAudience: 'eliza-alpha-phone',
  }),
  staging: Object.freeze({
    api: 'https://api-staging.eliza.app',
    web: 'https://staging.eliza.app',
    services: 'https://cloud-staging.eliza.app',
    tenant: 'elizacloud-staging',
    name: 'Eliza Cloud',
    entitlementAudience: 'eliza-alpha-phone',
  }),
});

/**
 * A candidate Cloud for development and cutover rehearsal: ALPHA_CLOUD_DEPLOYMENT_FILE names a
 * JSON file with the same `production` and `staging` rows. Every build and operator tool then
 * addresses that Cloud instead. A candidate build has its own credential namespace, and the
 * production bundle audit refuses it, so it cannot be distributed by accident.
 */
const candidateFile = process.env.ALPHA_CLOUD_DEPLOYMENT_FILE?.trim();
export const CLOUD_DEPLOYMENT_IS_CANDIDATE = !!candidateFile;
/** Alpha's public Cloud registration, shared by build and operator tools. */
export const CLOUD_DEPLOYMENT: typeof SHIPPED_CLOUD_DEPLOYMENT = candidateFile
  ? Object.freeze(JSON.parse(fs.readFileSync(candidateFile, 'utf8')))
  : SHIPPED_CLOUD_DEPLOYMENT;
