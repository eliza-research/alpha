package ai.elizaresearch.alphaphone;

/** Generated from config/cloud-deployment.json. Run node scripts/cloud-deployment.ts. */
final class CloudDeployment {
 private CloudDeployment() {}
 static final String PRODUCTION_API = "https://api.eliza.app";
 static final String PRODUCTION_WEB = "https://eliza.app";
 static final String PRODUCTION_SERVICES = "https://cloud.eliza.app";
 static final String PRODUCTION_TENANT = "elizacloud";
 static final String PRODUCTION_NAME = "Eliza Cloud";
 static final String PRODUCTION_ENTITLEMENT_AUDIENCE = "eliza-alpha-phone";
 static final String PRODUCTION_API_HOST = "api.eliza.app";
 static final String PRODUCTION_WEB_HOST = "eliza.app";
 static final String PRODUCTION_SERVICES_HOST = "cloud.eliza.app";
 static final String STAGING_API = "https://api-staging.eliza.app";
 static final String STAGING_WEB = "https://staging.eliza.app";
 static final String STAGING_SERVICES = "https://cloud-staging.eliza.app";
 static final String STAGING_TENANT = "elizacloud-staging";
 static final String STAGING_NAME = "Eliza Cloud";
 static final String STAGING_ENTITLEMENT_AUDIENCE = "eliza-alpha-phone";
 static final String STAGING_API_HOST = "api-staging.eliza.app";
 static final String STAGING_WEB_HOST = "staging.eliza.app";
 static final String STAGING_SERVICES_HOST = "cloud-staging.eliza.app";
 static final String STORAGE_NAMESPACE = "cloud-deployment:897efc6f09b9d4db345c61226d8301a9f1257ad98f0491e8591f63d4f4515874:";
 static String storageSlot(String name) {
  return name != null && (name.startsWith("cloud:") || name.startsWith("cloud-signin:") || name.equals("local-agent-provider:v1")) ? STORAGE_NAMESPACE + name : name;
 }
}
