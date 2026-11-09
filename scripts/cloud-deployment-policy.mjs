/** Installed sign-in routes and browser return namespace, owned by this consumer. */
export const CLOUD_SIGN_IN_REGISTRATION = Object.freeze({
  callbackPath: '/alphaphone/auth/callback',
  browserSignIn: Object.freeze({
    startPath: '/alphaphone/auth/browser-start',
    returnPath: '/__alpha-browser-cloud/signin-return',
    storageKey: 'alpha-browser-sign-in:v1',
  }),
});

/** Alpha's public Cloud registration, shared by build and operator tools. */
export const CLOUD_DEPLOYMENT = Object.freeze({
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
