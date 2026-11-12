import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
// Native evening briefs and lapsed-source pausing exist only in agents with patched plugin-workflow (0050).
// The app reads them from /status and never offers or claims them for an agent that omits the flags.
const root=resolve(import.meta.dirname,'..');
const script=`
const d=await import(${JSON.stringify(resolve(root,'apps/app/src/runtime/hosted-digests.ts'))});
const status=body=>new d.HostedDigestProtocol(async path=>{if(path!=='/api/workflow/status')throw Error(path);return body;});
const signal=new AbortController().signal,out={};
out.old=await status({hostedDigestProtocol:1,hostedNativeSourceProtocol:1}).capabilities(signal);
out.patched=await status({hostedDigestProtocol:1,hostedDigestSourcePauseProtocol:1,hostedNativeSourceProtocol:1,hostedNativeEveningProtocol:1}).capabilities(signal);
out.eveningWithoutNative=await status({hostedDigestProtocol:1,hostedNativeEveningProtocol:1}).capabilities(signal);
out.dossier=await status({hostedDigestProtocol:1,hostedNativeSourceProtocol:1,hostedDossierProtocol:1}).capabilities(signal);
out.dossierOther=await status({hostedDigestProtocol:1,hostedNativeSourceProtocol:1,hostedDossierProtocol:true}).capabilities(signal);
const now=Date.parse('2026-10-08T12:00:00Z'),source={id:'s',revision:'r',kind:'tasks',label:'Phone',observedAt:'2026-10-01T12:00:00Z',expiresAt:'2026-10-08T11:00:00Z',revoked:false};
const loop={id:'l',versionId:'v',name:'Morning digest',active:true,removed:false,spec:{version:1,template:'morning',sourceId:'s',sourceRevision:'r',timeZone:'UTC',localTime:'08:00',enabled:true}};
out.oldState=d.digestLoopState(loop,[source],now,false);
out.pausedState=d.digestLoopState(loop,[source],now,true);
out.revoked=d.digestLoopState(loop,[{...source,revoked:true}],now,true);
out.current=d.digestLoopState(loop,[{...source,expiresAt:'2026-10-10T12:00:00Z'}],now,false);
out.renewals=d.digestRenewals([source,{...source,id:'soon',expiresAt:'2026-10-09T06:00:00Z'},{...source,id:'later',expiresAt:'2026-10-12T12:00:00Z'}],[loop,{...loop,id:'l2',spec:{...loop.spec,sourceId:'soon'}},{...loop,id:'l3',spec:{...loop.spec,sourceId:'later'}}],now).map(r=>[r.source.id,r.state]);
console.log(JSON.stringify(out));`;
test('native evening, source pausing and the dossier follow what the agent advertises',()=>{
 const out=JSON.parse(execFileSync(process.execPath,['-e',script],{cwd:root,encoding:'utf8',timeout:60000}));
 assert.deepEqual(out.old,{digests:true,nativeSources:true,nativeEvening:false,sourcePause:false,dossier:false});
 assert.deepEqual(out.patched,{digests:true,nativeSources:true,nativeEvening:true,sourcePause:true,dossier:false});
 assert.equal(out.eveningWithoutNative.nativeEvening,false);
 // The advertisement is still parsed exactly; the renderer gates on the resident agent (see below).
 assert.equal(out.dossier.dossier,true);assert.equal(out.dossierOther.dossier,false);
 assert.equal(out.oldState,'Source expired — renew to resume');
 assert.equal(out.pausedState,'Source expired — paused');
 assert.equal(out.revoked,'Source revoked — paused');
 assert.equal(out.current,'On');
 assert.deepEqual(out.renewals,[['s','expired'],['soon','expiring']]);
});
