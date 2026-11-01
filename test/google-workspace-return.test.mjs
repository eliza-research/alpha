import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBrowserModule} from './fixtures/browser-source.mjs';
const [flow,protocol,accounts]=await loadBrowserModule(['apps/app/src/runtime/google-workspace-return.ts','apps/app/src/runtime/cloud-protocol.ts','apps/app/src/runtime/google-accounts.ts']);
const state='A'.repeat(43),redirect=flow.GOOGLE_WORKSPACE_CALLBACK+'?state='+state;
const binding={environment:'production',userId:'11111111-1111-4111-8111-111111111111',organizationId:'22222222-2222-4222-8222-222222222222',credentialId:'credential',sessionId:'ui-session'};
const signal=()=>new AbortController().signal;
const tick=()=>new Promise(r=>setTimeout(r,0));
function native(result={result:'none'}){let listener,removed=0,calls=0;return {port:{async prepare(){return {supported:true,redirectUrl:redirect,state}},async cancel(){},async consume(){calls++;return result},async subscribe(fn){listener=fn;return{remove(){removed++}}}},fire(){listener?.()},get calls(){return calls},get removed(){return removed}}}

test('only advertised complete native method capability enables the return adapter',()=>{
 const methods=['prepareGoogleWorkspaceReturn','consumeGoogleWorkspaceReturn','cancelGoogleWorkspaceReturn'].map(name=>({name}));
 assert.equal(flow.nativeGoogleWorkspaceReturnAvailable([{name:'AlphaConnection',methods}]),true);
 for(const headers of [undefined,[],[{name:'AlphaConnection'}],[{name:'AlphaConnection',methods:methods.slice(1)}],[{name:'Other',methods}]])assert.equal(flow.nativeGoogleWorkspaceReturnAvailable(headers),false);
});
test('callback redirect accepts only exact target and single literal nonce',()=>{
 assert.equal(flow.googleWorkspaceRedirectAllowed(redirect),true);
 for(const value of [redirect+'&x=1',redirect+'&state='+state,redirect+'#ok',redirect.replace('https:','http:'),redirect.replace('alphacompute.ai','evil.test'),redirect.replace('state=','%73tate='),redirect.replace('?','/?')])assert.equal(flow.googleWorkspaceRedirectAllowed(value),false,value);
});
test('missing native capability uses existing manual return without any port call',async()=>{assert.equal(await flow.prepareGoogleWorkspaceReturn(undefined,binding,()=>binding),undefined)});
test('unsupported native association preserves manual return',async()=>{const n=native();n.port.prepare=async()=>({supported:false});assert.equal(await flow.prepareGoogleWorkspaceReturn(n.port,binding,()=>binding),undefined)});
test('binding changes during prepare cancel only the issued nonce and reject',async()=>{
 const n=native();let owner=binding,cancelled=[];n.port.prepare=async()=>{owner={...binding,credentialId:'new'};return{supported:true,redirectUrl:redirect,state}};n.port.cancel=async s=>cancelled.push(s);
 await assert.rejects(flow.prepareGoogleWorkspaceReturn(n.port,binding,()=>owner),{name:'AbortError'});assert.deepEqual(cancelled,[state]);
});
test('current supported offer retains only the exact redirect and nonce',async()=>{const n=native();assert.deepEqual(await flow.prepareGoogleWorkspaceReturn(n.port,binding,()=>binding),{redirectUrl:redirect,state})});
for(const result of [{result:'connected',connectionId:'owned-connection'},{result:'denied'},{result:'failed'}])test('cold identity-ready consumer handles '+result.result+' without panel-open state',async()=>{
 const n=native(result),seen=[];const w=flow.watchGoogleWorkspaceReturn(n.port,binding,()=>binding,r=>seen.push(r),()=>assert.fail('unexpected error'));await w.ready;assert.deepEqual(seen,[result]);w.close();assert.equal(n.removed,1);
});
test('no return marker never opens or refreshes a panel',async()=>{const n=native(),seen=[];const w=flow.watchGoogleWorkspaceReturn(n.port,binding,()=>binding,r=>seen.push(r),()=>{});await w.ready;assert.deepEqual(seen,[]);w.close()});
test('warm account switch after native consume suppresses stale UI publication',async()=>{
 let owner=binding;const n=native();n.port.consume=async()=>{owner={...binding,sessionId:'replacement'};return{result:'connected',connectionId:'owned'}};const seen=[];const w=flow.watchGoogleWorkspaceReturn(n.port,binding,()=>owner,r=>seen.push(r),()=>{});await w.ready;assert.deepEqual(seen,[]);w.close();
});
test('late listener registration after unmount removes itself and consumes nothing',async()=>{
 let done;const n=native({result:'connected',connectionId:'owned'});n.port.subscribe=()=>new Promise(r=>done=r);const w=flow.watchGoogleWorkspaceReturn(n.port,binding,()=>binding,()=>assert.fail(),()=>{});w.close();let removed=0;done({remove(){removed++}});await w.ready;assert.equal(removed,1);assert.equal(n.calls,0);
});
test('duplicate events cannot concurrently consume or publish while native CAS is in flight',async()=>{
 const n=native();let done;n.port.consume=()=>new Promise(r=>done=r);let published=0;const w=flow.watchGoogleWorkspaceReturn(n.port,binding,()=>binding,()=>published++,()=>{});await tick();n.fire();n.fire();done({result:'connected',connectionId:'owned'});await w.ready;assert.equal(published,1);w.close();
});
test('protocol sends exact optional redirect only on opt-in and preserves scopes',async()=>{
 const calls=[];let appReturn=2;const credential={credentialId:'credential',token:'synthetic',userId:binding.userId,organizationId:binding.organizationId};
 const c=new protocol.CloudProtocol('production',async request=>{calls.push(request);return{status:200,data:{authUrl:'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic',appReturn}}},{read:async()=>credential,write:async()=>{},clear:async()=>{}},async()=>{});
 const old=await c.initiateGoogle(signal());assert.equal(typeof old,'string');assert.equal(calls[0].body.redirectUrl,undefined);
 const result=await c.initiateGoogleWithReturn(signal(),redirect);assert.equal(result.appReturn,true);assert.equal(calls[1].body.redirectUrl,redirect);assert.deepEqual(calls[1].body.capabilities,calls[0].body.capabilities);
 appReturn=undefined;assert.equal((await c.initiateGoogleWithReturn(signal(),redirect)).appReturn,false);
 await assert.rejects(c.initiateGoogleWithReturn(signal(),'https://evil.test/?state='+state),TypeError);assert.equal(calls.length,3);
});
test('older client without optional return method falls back without changing connection semantics',async()=>{
 const client={async initiateGoogle(){return 'https://accounts.google.com/'},async gmailAccounts(){return []},async disconnectGmail(){assert.fail('no revoke')}};const owner={client,credentialId:'credential',sessionId:'session'};const facade=accounts.createGoogleAccounts(owner,()=>owner);
 assert.deepEqual(await facade.connectWithReturn(signal(),redirect),{authUrl:'https://accounts.google.com/',appReturn:false});
});

test('staging remains manual before invoking any native return preparation',async()=>{const n=native();n.port.prepare=async()=>assert.fail('No staging native prepare');assert.equal(await flow.prepareGoogleWorkspaceReturn(n.port,{...binding,environment:'staging'},()=>({...binding,environment:'staging'})),undefined)});

test('an event received during a pending empty consume schedules one fresh drain',async()=>{
 const n=native();let finish,reads=0,published=[];
 n.port.consume=async()=>{reads++;if(reads===1)return new Promise(resolve=>finish=resolve);return{result:'connected',connectionId:'late-grant'}};
 const w=flow.watchGoogleWorkspaceReturn(n.port,binding,()=>binding,result=>published.push(result),()=>assert.fail());
 await tick();n.fire();n.fire();finish({result:'none'});await w.ready;await tick();
 assert.equal(reads,2);assert.deepEqual(published,[{result:'connected',connectionId:'late-grant'}]);w.close();
});
