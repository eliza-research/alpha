import fs from 'node:fs';
export const cloudEnvironments = ['production', 'staging'] as const;
export type CloudEnvironment = (typeof cloudEnvironments)[number];

function sdkBase(api: unknown): string {
 const url = typeof api === 'string' ? URL.parse(api) : null;
 // Provider keys are sent to this base, so only an exact HTTPS origin is accepted.
 if (!url || url.protocol !== 'https:' || url.origin !== api) throw Error('Invalid Cloud API origin');
 return url.origin + '/api/v1';
}

/** Cloud SDK bases come from the API origins, never the service origins. */
export function cloudSdkBases(config: Partial<Record<CloudEnvironment, {api?: unknown}>> | null | undefined) {
 return Object.freeze({
  production: sdkBase(config?.production?.api),
  staging: sdkBase(config?.staging?.api),
 });
}
/** The deployment's bases, read from config/cloud-deployment.json (checked by scripts/cloud-deployment.ts --check). */
export const CLOUD_SDK_BASES=cloudSdkBases(JSON.parse(fs.readFileSync(new URL('../config/cloud-deployment.json',import.meta.url),'utf8')));
