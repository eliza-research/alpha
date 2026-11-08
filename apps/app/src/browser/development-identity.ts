import type {BrowserDomainDocument,DomainRecovery} from './domain-document';
import {developmentCloudAccount,readDevelopmentCloudAccount} from './development-cloud';
import {devSurfacesEnabled} from '../build-flags';
import {browserDevProfile} from './dev-profile';
export const developmentProfiles=['local','cloud','remote'] as const;
export type DevelopmentProfile=typeof developmentProfiles[number];
export function assertDevelopmentProfile(profile:DevelopmentProfile){if(!devSurfacesEnabled||!browserDevProfile||!developmentProfiles.includes(profile))throw Error('Choose a development profile.');}
export type DevelopmentIdentity={profile:DevelopmentProfile;account?:'first'|'second';session?:string;namespace:string;ownerId:string;agentId:string};
/** Default reply for explicit development profiles; absent from flag-off builds. */
export const developmentDefaultReply:string=devSurfacesEnabled?'Development reply. Edit this response in Agent connection.':'';
export function developmentIdentity(profile:DevelopmentProfile):DevelopmentIdentity{
 if(!devSurfacesEnabled)throw Error('Development profiles are unavailable in this build.');
 const account=profile==='cloud'?developmentCloudAccount():null,namespace=profile+(account?`.${account.account}`:'');
 return {profile,...(account?{account:account.account,session:account.session}:{}),namespace,ownerId:`development-${namespace}-owner`,agentId:`development-${namespace}-agent`};
}
export function assertDevelopmentIdentity(identity:DevelopmentIdentity){const current=developmentIdentity(identity.profile);if(current.namespace!==identity.namespace||current.session!==identity.session)throw Error('Development account changed.');}

export async function readDevelopmentIdentity(profile:DevelopmentProfile,signal?:AbortSignal):Promise<DevelopmentIdentity>{if(profile==='cloud')await readDevelopmentCloudAccount(signal);signal?.throwIfAborted();return developmentIdentity(profile);}
export async function verifyDevelopmentIdentity(identity:DevelopmentIdentity,signal?:AbortSignal){const current=await readDevelopmentIdentity(identity.profile,signal);if(current.namespace!==identity.namespace||current.session!==identity.session)throw Error('Development account changed.');}

/** Recovery remains tied to the captured owner even if a tab misses invalidation. */
export function developmentOwnerRecovery(domain:Pick<BrowserDomainDocument,'capture'|'reset'>,identity:DevelopmentIdentity){return {
 async capture(signal?:AbortSignal){await verifyDevelopmentIdentity(identity,signal);const value=await domain.capture(signal);await verifyDevelopmentIdentity(identity,signal);return value;},
 async reset(expected:DomainRecovery,signal?:AbortSignal){await verifyDevelopmentIdentity(identity,signal);await domain.reset(expected,signal);await verifyDevelopmentIdentity(identity,signal);},
};}
