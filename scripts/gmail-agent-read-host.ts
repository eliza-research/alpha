/** Browser-profile composition of the shared owner-bound Google host. */
import {createBrowserCloudDevHandler} from './browser-cloud-dev-bridge.ts';
import {createManagedGoogleAgentHost,type GoogleAgentAccess} from '../backend/managed-google-agent-host.ts';
export function createGmailAgentReadHost(profile:string,access?:()=>GoogleAgentAccess){
 return createManagedGoogleAgentHost(createBrowserCloudDevHandler({profile}),access);
}
