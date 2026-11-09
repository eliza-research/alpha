// Generated from scripts/cloud-deployment-policy.mjs. Run node scripts/cloud-deployment.mjs.
export const productionCloud = {"name":"Eliza Cloud","entitlementAudience":"eliza-alpha-phone","api":"https://api.eliza.app","web":"https://eliza.app","agents":"cloud.eliza.app","tenant":"elizacloud"} as const;
export const stagingCloud = {"name":"Eliza Cloud","entitlementAudience":"eliza-alpha-phone","api":"https://api-staging.eliza.app","web":"https://staging.eliza.app","agents":"cloud-staging.eliza.app","tenant":"elizacloud-staging"} as const;
export const cloudStorageNamespace = "cloud-deployment:897efc6f09b9d4db345c61226d8301a9f1257ad98f0491e8591f63d4f4515874:";
export function cloudStorageSlot(name:string):string { return name.startsWith("cloud:") || name.startsWith("cloud-signin:") || name === "local-agent-provider:v1" ? cloudStorageNamespace + name : name; }
