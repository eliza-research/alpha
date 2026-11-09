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
