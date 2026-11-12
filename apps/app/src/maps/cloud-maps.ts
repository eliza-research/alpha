import { createCloudMaps, type CloudMapsBasemap, type CloudMapsCoverage } from './cloud-provider';
import { captureMapsSession } from './cloud-session';
import { configureMapsProvider } from './runtime';
import { connectionController } from '../runtime/connection-ui';
import { readServiceLimit } from '../runtime/subscription-entitlement.ts';

/**
 * Cloud supplies data only; retained routes belong to the session that requested them.
 * Limits are read with the app's shared subscription reader, which also honours the
 * Retry-After header and nested terminal-failure rate limits.
 */
const maps = createCloudMaps(() => captureMapsSession(() => connectionController.getCloudClient()), configureMapsProvider, { serviceLimit: readServiceLimit,
 tileRequest:()=>{
  const owner=connectionController.getCloudClient();
  const current=()=>{const now=connectionController.getCloudClient();if(!owner||!now||owner.sessionId!==now.sessionId||owner.credentialId!==now.credentialId)throw Error('The Maps account changed.');return now;};
  return async(z,x,y,signal)=>{const active=current();const bytes=await active.client.mapsTile(z,x,y,signal);current();signal.throwIfAborted();return bytes;};
 },
});
export const { initializeCloudMaps, cloudMapsCoverage, cloudMapsDiagnostics } = maps;
let basemapCoverage:CloudMapsCoverage|undefined,basemap:CloudMapsBasemap|undefined;
/** Keep one plane identity for the current coverage/account, retiring it when coverage changes. */
export function cloudMapsBasemap():CloudMapsBasemap|undefined {
 const coverage=cloudMapsCoverage();
 if(coverage!==basemapCoverage){basemapCoverage=coverage;basemap=maps.cloudMapsBasemap();}
 return basemap;
}
let previous = connectionController.getCloudClient();
connectionController.subscribe(() => {
 const next = connectionController.getCloudClient();
 const changed = previous?.sessionId !== next?.sessionId || previous?.credentialId !== next?.credentialId;
 previous = next;
 // A rebuilt client for the same session and credential keeps guidance; requests resolve the client per call.
 if (changed) {
  // Retry requires an explicit search; a new account never inherits automatic rerouting.
  if (maps.cloudMapsDiagnostics().configured) maps.retireCloudMaps();
 }
});
