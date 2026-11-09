import {
  readGoogleAgentAccessFile,
  startNativeGoogleAgentHost as startSharedHost,
  type NativeGoogleBinding,
} from '../.eliza/client-features/packages/app/src/runtime/managed-google-agent/index.ts';
import {productionCloud} from '../apps/app/src/runtime/cloud-deployment.generated.ts';

export {readGoogleAgentAccessFile};
export {nativeCloudRuntime} from '../apps/app/src/product/native-cloud-runtime.ts';

/** Bind the shared host to this product's deployment and installed settings slot. */
export function startNativeGoogleAgentHost(options: {
  binding: NativeGoogleBinding;
  apiToken: string;
  request?: typeof fetch;
  assertCurrent?: () => void;
}) {
  return startSharedHost({
    ...options,
    apiOrigin: productionCloud.api,
    userAgent: 'AlphaPhone-Native-Google/1',
    access: () => readGoogleAgentAccessFile(process.env.ALPHA_GOOGLE_AGENT_ACCESS_FILE),
    calendarReadTiming: process.env.ALPHA_CALENDAR_READ_TIMING === '1',
  });
}
