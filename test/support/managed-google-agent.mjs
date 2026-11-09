import {
  createManagedGoogleAgentHost as createSharedHost,
  createNativeGoogleCloudPort as createSharedPort,
  readGoogleAgentAccessFile,
  startManagedGoogleAgentHost as startSharedHost,
} from '../../.eliza/client-features/packages/app/src/runtime/managed-google-agent/index.ts';
import {productionCloud, stagingCloud} from '../../apps/app/src/runtime/cloud-deployment.generated.ts';

export {startNativeGoogleAgentHost} from '../../scripts/native-google-product-host.ts';

export function savedGoogleAgentAccess(file = process.env.ALPHA_GOOGLE_AGENT_ACCESS_FILE) {
  return readGoogleAgentAccessFile(file);
}

export function createNativeGoogleCloudPort(binding, assertCurrent, request) {
  return createSharedPort(binding, {
    apiOrigin: productionCloud.api,
    userAgent: 'AlphaPhone-Native-Google/1',
    assertCurrent,
    request,
  });
}

export function createManagedGoogleAgentHost(port, access = () => ({gmailChanges: true, calendarEdits: true})) {
  return createSharedHost(port, {
    apiOrigin: productionCloud.api,
    access,
    calendarReadTiming: process.env.ALPHA_CALENDAR_READ_TIMING === '1',
  });
}

export function startManagedGoogleAgentHost({environment, ...options}) {
  return startSharedHost({...options, apiOrigin: environment === 'staging' ? stagingCloud.api : productionCloud.api});
}
