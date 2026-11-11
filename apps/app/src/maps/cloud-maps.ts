import { createCloudMaps, type CloudMapsBasemap, type CloudMapsCoverage, type CloudMapsRequest } from './cloud-provider';
import { captureMapsSession } from './cloud-session';
import { configureMapsProvider } from './runtime';
import { connectionController } from '../runtime/connection-ui';
import { readServiceLimit } from '../runtime/subscription-entitlement.ts';

/**
 * Cloud supplies data only; retained routes belong to the session that requested them.
 * Limits are read with the app's shared subscription reader, which also honours the
 * Retry-After header and nested terminal-failure rate limits.
 */
type BoundClient = NonNullable<ReturnType<typeof connectionController.getCloudClient>>;
/** The binding when it is still the given session and credential; any other binding is refused. */
function sameAccount(owner: BoundClient | null): BoundClient {
 const now = connectionController.getCloudClient();
 if (!owner || !now || owner.sessionId !== now.sessionId || owner.credentialId !== now.credentialId) throw Error('The Maps account changed.');
 return now;
}
/**
 * The provider owns a session and credential, not one client object: the same account bound
 * again with a rebuilt client serves the next request, and a new session or credential refuses it.
 */
const accountClient: { mapsRequest: CloudMapsRequest } = {
 mapsRequest: (route, signal, body) => {
  const now = connectionController.getCloudClient();
  if (!now) throw Error('Sign in to Cloud to use Maps.');
  return now.client.mapsRequest(route, signal, body);
 },
};
const mapsSession = () => {
 const now = connectionController.getCloudClient();
 return now && { sessionId: now.sessionId, credentialId: now.credentialId, client: accountClient };
};
const maps = createCloudMaps(() => captureMapsSession(mapsSession), configureMapsProvider, { serviceLimit: readServiceLimit,
 tileRequest:()=>{
  const owner=connectionController.getCloudClient();
  return async(z,x,y,signal)=>{const bytes=await sameAccount(owner).client.mapsTile(z,x,y,signal);sameAccount(owner);signal.throwIfAborted();return bytes;};
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
 // A rebuilt client for the same session and credential keeps the provider and its guidance; requests resolve the client per call.
 if (changed) {
  // Retry requires an explicit search; a new account never inherits automatic rerouting.
  if (maps.cloudMapsDiagnostics().configured) maps.retireCloudMaps();
 }
});
