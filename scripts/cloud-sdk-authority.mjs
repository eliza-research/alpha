import {CLOUD_DEPLOYMENT} from './cloud-deployment-policy.mjs';
/** Cloud SDK bases: each configured API origin plus Cloud's versioned prefix. Service origins are not SDK bases. */
export function cloudSdkBases(config){
 return Object.freeze(Object.fromEntries(['production','staging'].map(environment=>{
  const api=config?.[environment]?.api;
  // Provider keys are sent to this base: only an exact https origin is accepted.
  if(typeof api!=='string'||!URL.canParse(api)||new URL(api).protocol!=='https:'||new URL(api).origin!==api)throw Error('Invalid Cloud API origin');
  return [environment,api+'/api/v1'];
 })));
}
export const CLOUD_SDK_BASES=cloudSdkBases(CLOUD_DEPLOYMENT);
