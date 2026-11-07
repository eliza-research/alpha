/** Browser-profile authentication for the private Google tool host. */
import {lstat,readFile} from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';
import {createGmailAgentReadHost} from './gmail-agent-read-host.ts';
import {createManagedGoogleAgentBroker} from '../backend/managed-google-agent-broker.ts';
import type {GoogleAgentAccess} from '../backend/managed-google-agent-host.ts';
export function createGmailAgentDevBroker(options:{profile:string;tokenFile:string;access?:()=>GoogleAgentAccess}){
 return createManagedGoogleAgentBroker({host:createGmailAgentReadHost(options.profile,options.access),async authorized(value){
  const st=await lstat(options.tokenFile);if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077))throw Error('Agent credential unavailable');
  const token=(await readFile(options.tokenFile,'utf8')).trim();if(!/^[a-f0-9]{64}$/.test(token))throw Error('Agent credential unavailable');
  const provided=Buffer.from(value||''),expected=Buffer.from('Bearer '+token);
  return provided.length===expected.length&&timingSafeEqual(provided,expected);
 }});
}
