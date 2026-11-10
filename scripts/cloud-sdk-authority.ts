import {CLOUD_DEPLOYMENT} from './cloud-deployment-policy.ts';
export const cloudEnvironments = ['production', 'staging'] as const;
export type CloudEnvironment = (typeof cloudEnvironments)[number];

/** Cloud SDK bases: each configured API origin plus Cloud's versioned prefix. Service origins are not SDK bases. */
export function cloudSdkBases(config: Record<CloudEnvironment, {api: string}>){
 return Object.freeze(Object.fromEntries(cloudEnvironments.map(environment=>{
  const api=config?.[environment]?.api;
  // Provider keys are sent to this base: only an exact https origin is accepted.
  if(typeof api!=='string'||!URL.canParse(api)||new URL(api).protocol!=='https:'||new URL(api).origin!==api)throw Error('Invalid Cloud API origin');
  return [environment,api+'/api/v1'];
 })) as Record<CloudEnvironment, string>);
}
export const CLOUD_SDK_BASES=cloudSdkBases(CLOUD_DEPLOYMENT);
