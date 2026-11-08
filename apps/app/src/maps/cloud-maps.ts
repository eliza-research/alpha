import { createCloudMaps } from './cloud-provider';
import { captureMapsSession } from './cloud-session';
import { configureMapsProvider } from './runtime';
import { connectionController } from '../runtime/connection-ui';
import { readServiceLimit } from '../runtime/subscription-entitlement.ts';

/**
 * Cloud supplies data only; retained routes belong to the session that requested them.
 * Limits are read with the app's shared subscription reader, which also honours the
 * Retry-After header and nested terminal-failure rate limits.
 */
const maps = createCloudMaps(() => captureMapsSession(() => connectionController.getCloudClient()), configureMapsProvider, { serviceLimit: readServiceLimit });
export const { initializeCloudMaps, cloudMapsCoverage, cloudMapsDiagnostics } = maps;
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
