import {HostedDigestProtocol} from '../apps/app/src/runtime/hosted-digests.ts';
/** A real protocol instance with only the closed results/ack ports replaced by a scenario. */
export function digestFixtureProvider(ports:{results?:(...args:any[])=>Promise<any[]>;ack?:(...args:any[])=>Promise<unknown>}):HostedDigestProtocol {
 const protocol=new HostedDigestProtocol(async()=>{throw Error('Unexpected digest fixture transport request');});
 return Object.assign(protocol,ports);
}
