import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,mkdirSync,copyFileSync,readFileSync,realpathSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve,dirname,sep} from 'node:path';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {sourceDirectory,verifySource} from '../scripts/local-agent-source.ts';

// The explicit-rejection receipt that Alpha once carried as a patch is part of the pinned upstream
// (elizaOS/eliza#36598). Exercise that upstream managed transport and mutation port over bounded
// synthetic HTTP responses, in an isolated copy; the pinned source stays unchanged.
// The transport, its managed Calendar reader, their contracts and the reader's zod all come from ONE
// normal prepared and installed SDK graph: the admitted runtime source at the pinned commit
// (npm run agent:prepare: the exact commit, then bun install --frozen-lockfile), verified before and
// after. vendor/eliza is source only, with no dependency install, so it cannot qualify this transport.
// npm test runs without a prepared graph and skips, as the Cloud signature classifier does; the
// resident-prepare job runs this file after agent:prepare with ALPHA_REQUIRE_PREPARED_SDK=1, where a
// missing graph fails instead of skipping.
const preparedGraph=sourceDirectory(resolve('.'));
const skipUnprepared=!existsSync(preparedGraph)&&process.env.ALPHA_REQUIRE_PREPARED_SDK!=='1'?'Prepared SDK graph unavailable; run npm run agent:prepare':false;
test('explicit Calendar rejection survives the private transport; uncertain replies stay blocked',{skip:skipUnprepared},async()=>{
 const commit=JSON.parse(readFileSync('upstream.lock.json','utf8')).commit,upstream=preparedGraph;
 assert.ok(existsSync(upstream),`The pinned SDK graph is not prepared at ${upstream}; run npm run agent:prepare`);
 verifySource(upstream,commit);
 const relative='plugins/plugin-calendar/src/mutations/managed.ts',original=join(upstream,relative);
 // zod as the reader itself resolves it: that graph's own install, at the version its lockfile resolves.
 const reader=join(upstream,'plugins/plugin-calendar/src/service/managed-calendar-read.ts');
 let zodManifest;
 try{zodManifest=realpathSync(createRequire(reader).resolve('zod/package.json'));}
 catch(error){assert.fail(`The prepared SDK graph has no zod for its managed Calendar reader (${error.code}); run npm run agent:prepare`);}
 assert.ok(zodManifest.startsWith(realpathSync(upstream)+sep),'zod is the prepared SDK graph\'s own dependency, not an Alpha or outside install');
 const sdkLock=readFileSync(join(upstream,'bun.lock'),'utf8');
 const lockedZod=(/"@elizaos\/plugin-calendar\/zod": \["zod@([^"]+)"/.exec(sdkLock)??/\n {4}"zod": \["zod@([^"]+)"/.exec(sdkLock))?.[1];
 assert.equal(JSON.parse(readFileSync(zodManifest,'utf8')).version,lockedZod,'the installed zod is the version the SDK lockfile resolves');
 const before=readFileSync(original,'utf8'),temp=mkdtempSync(join(tmpdir(),'alpha-calendar-refusal-'));
 try{
  const entry=join(temp,relative);mkdirSync(dirname(entry),{recursive:true});copyFileSync(original,entry);
  assert.match(before,/raw\.calendarFailure/,'the pinned upstream carries the explicit rejection receipt');assert.match(before,/Invalid Calendar rejection receipt/);
  const buildPort=contents=>build({stdin:{contents:`export {createManagedCalendarMutationPort} from ${JSON.stringify(entry)};export {CalendarMutationNotAcceptedError,CalendarMutationPreflightError} from ${JSON.stringify(join(dirname(original),'types.ts'))};`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,metafile:true,plugins:[{name:'upstream-patch-source',setup(b){
   b.onLoad({filter:/managed\.ts$/},args=>args.path===realpathSync(entry)?{contents,loader:'ts',resolveDir:dirname(original)}:undefined);
   b.onResolve({filter:/^@elizaos\/core$/},()=>({path:'core',namespace:'port'}));
   // Resolve the reader's real runtime contract from the same pinned upstream source.
   b.onResolve({filter:/^@elizaos\/contracts$/},()=>({path:join(upstream,'packages/contracts/src/calendar.ts')}));
   b.onResolve({filter:/^\.\/ledger\.js$/},()=>({path:'ledger',namespace:'port'}));
   b.onLoad({filter:/.*/,namespace:'port'},args=>({loader:'js',contents:args.path==='core'?'export class ElizaError extends Error{}':'export const calendarMutationApprovalSha256=()=>"hash";export const calendarMutationOperationKey=()=>"stable-key";'}));
  }}]});
  const bundle=await buildPort(readFileSync(entry,'utf8'));
  // The bundled zod is exactly that install: no stub, alias or other donor reached the transport.
  const zodInputs=Object.keys(bundle.metafile.inputs).filter(input=>input.split('/').includes('zod')).map(input=>realpathSync(resolve(input)));
  assert.ok(zodInputs.length>0,'the managed reader bundles zod');
  for(const input of zodInputs)assert.ok(input.startsWith(dirname(zodManifest)+sep),`bundled zod ${input} is the verified install`);
  const {createManagedCalendarMutationPort,CalendarMutationNotAcceptedError,CalendarMutationPreflightError}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const source='alpha-google:'+'a'.repeat(64),caps={version:1,grantId:source,calendarId:'calendar',accountId:'account',read:true,write:true,idempotentCreate:true,conditionalWrites:true,providerExactlyOnce:false};
  const approval={payload:{action:'schedule_event',side:'owner',grantId:source,calendarId:'calendar',title:'Synthetic Calendar review',startsAtMs:Date.parse('2026-11-10T15:00:00Z'),endsAtMs:Date.parse('2026-11-10T16:00:00Z'),timeZone:'UTC',attendees:[],notifyAttendees:false}};
  for(const kind of ['not_accepted','precondition_failed','wrong-account','unknown','generic-http','timeout']){
   let mutations=0;
   const request=async(url,init)=>{
    assert.equal(String(url),'http://127.0.0.1:12345/__alpha-owner-gmail');assert.equal(init.headers.Authorization,'Bearer '+'b'.repeat(64));
    const {calendar}=JSON.parse(init.body);if(calendar.operation==='write-capabilities')return Response.json(caps);
    assert.equal(calendar.operation,'write-execute');mutations++;
    if(kind==='timeout')throw new TypeError('Network timeout');if(kind==='generic-http')return Response.json({error:'unverified'},{status:409});
    return Response.json({calendarFailure:{grantId:source,calendarId:'calendar',accountId:kind==='wrong-account'?'another-account':'account',code:'CALENDAR_SYNC_INVALID',outcome:kind}});
   };
   const {port}=createManagedCalendarMutationPort({ELIZA_MANAGED_CALENDAR_READ_BROKER:'http://127.0.0.1:12345/__alpha-owner-gmail',ELIZA_API_TOKEN:'b'.repeat(64)},request,'agent');
   const preflight=await port.preflight(approval);
   await assert.rejects(port.execute(approval,preflight),error=>{
    if(kind==='not_accepted')return error instanceof CalendarMutationNotAcceptedError&&error.failure.retryable===true&&error.failure.code==='CALENDAR_SYNC_INVALID';
    if(kind==='precondition_failed')return error instanceof CalendarMutationPreflightError&&error.failure.retryable===false&&error.failure.code==='CALENDAR_SYNC_INVALID';
    return !(error instanceof CalendarMutationNotAcceptedError)&&!(error instanceof CalendarMutationPreflightError);
   });
   assert.equal(mutations,1,'no automatic replay');
  }
  // Use the actual authenticated loopback broker for the regression that lost the refusal.
  // Use the broker's projected module so the typed refusal has the same constructor.
  const host=resolve('.eliza/client-features/plugins/plugin-calendar/src/service/managed-calendar-host.ts');
  const brokerBundle=await build({entryPoints:['scripts/gmail-agent-dev-broker.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'synthetic-cloud-owner-port',setup(b){
   b.onResolve({filter:/^\.\/gmail-agent-read-host\.ts$/},()=>({path:'reader',namespace:'cloud-fixture'}));
   b.onLoad({filter:/.*/,namespace:'cloud-fixture'},()=>({loader:'js',resolveDir:process.cwd(),contents:`import {calendarAgentWrite} from ${JSON.stringify(host)};export const createGmailAgentReadHost=()=>({calendarWrite:(input,signal)=>calendarAgentWrite(globalThis.calendarRefusalFixture.client,'grant','a'.repeat(64),input,signal,'alpha-google')});`}));
  }}]});
  const {createGmailAgentDevBroker}=await import('data:text/javascript;base64,'+Buffer.from(brokerBundle.outputFiles[0].text).toString('base64'));
  const tokenFile=join(temp,'token');writeFileSync(tokenFile,'b'.repeat(64),{mode:0o600});let writes=0;
  globalThis.calendarRefusalFixture={client:{googleCalendarSync:async input=>{if(input.kind==='capabilities')return caps;writes++;throw Object.assign(new Error('Synthetic authenticated Cloud rejection'),{name:'CloudProtocolError',code:'http',status:400,data:{code:'CALENDAR_SYNC_INVALID',outcome:'not_accepted'}});}}};
  const server=createServer(createGmailAgentDevBroker({profile:temp,tokenFile,access:()=>({gmailChanges:false,calendarEdits:true})}));
  try{
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const endpoint=`http://127.0.0.1:${server.address().port}/__alpha-owner-gmail`;
   const {port}=createManagedCalendarMutationPort({ELIZA_MANAGED_CALENDAR_READ_BROKER:endpoint,ELIZA_API_TOKEN:'b'.repeat(64)},fetch,'agent');
   const preflight=await port.preflight(approval);await assert.rejects(port.execute(approval,preflight),error=>error instanceof CalendarMutationNotAcceptedError);assert.equal(writes,1);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));delete globalThis.calendarRefusalFixture;}
  assert.equal(readFileSync(original,'utf8'),before,'the pinned source is not edited by qualification');
  verifySource(upstream,commit);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
