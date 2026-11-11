/** Browser-profile composition of the shared owner-bound Google host. */
import {createBrowserCloudDevHandler} from './browser-cloud-dev-bridge.ts';
import {createManagedGoogleAgentHost,type GoogleAgentAccess} from '../.eliza/client-features/packages/app/src/runtime/managed-google-agent/index.ts';
import {productionCloud} from '../apps/app/src/runtime/cloud-deployment.generated.ts';

export function createGmailAgentReadHost(profile:string,access:()=>GoogleAgentAccess){
 return createManagedGoogleAgentHost(createBrowserCloudDevHandler({profile}),{apiOrigin:productionCloud.api,access,gmailReadBodyMaxCharacters:32_000,calendarReadTiming:process.env.ALPHA_CALENDAR_READ_TIMING==='1'});
}
