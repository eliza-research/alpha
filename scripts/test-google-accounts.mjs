import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';

const bundled = buildSync({entryPoints:['apps/app/src/runtime/google-accounts.ts'],bundle:true,write:false,platform:'node',format:'esm',define:{'import.meta.env':'{}'}}).outputFiles[0].text;
const {createGoogleAccounts,googleDisconnectConfirmation,googleDisconnectMessage,GOOGLE_ACCOUNTS_CHANGED} = await import('data:text/javascript;base64,' + Buffer.from(bundled).toString('base64'));
const account = {configured:true,connected:true,connectionId:'owned-grant',label:'owner@example.test',reason:'connected',grantedCapabilities:['google.gmail.triage','google.calendar.read']};
function fixture(overrides={}) {
  const calls=[], events=[];
  const client={
    async initiateGoogle(_signal,permission,gmailPermission){calls.push(['connect',permission,gmailPermission]);return 'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic';},
    async gmailAccounts(){calls.push(['list']);return [account];},
    async disconnectGmail(id){calls.push(['disconnect',id]);},
    ...overrides,
  };
  let current={client,sessionId:'cloud-session',credentialId:'cloud-credential'};
  const captured=current;
  return {calls,events,client,captured,setCurrent:value=>{current=value;},helper:createGoogleAccounts(captured,()=>current,()=>events.push(GOOGLE_ACCOUNTS_CHANGED))};
}
const signal=()=>new AbortController().signal;
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

test('combined Google authorization defaults to calendar read and requires an explicit write request',async()=>{
  const f=fixture();
  assert.match(await f.helper.connect(signal()),/^https:\/\/accounts.google.com\//);
  await f.helper.connect(signal(),'write');
  assert.deepEqual(f.calls,[['connect','read','read'],['connect','write','read']]);
  await f.helper.connect(signal(),'read','send');
  assert.deepEqual(f.calls.at(-1),['connect','read','send'],'optional sending preserves calendar read consent');
  assert.deepEqual(f.events,[],'an authorization URL is not proof that authorization completed');
  assert.deepEqual(await f.helper.list(signal()),[account]);
});
test('confirmed disconnect reuses one revocation and a readback, then invalidates other views',async()=>{
  const f=fixture({async gmailAccounts(){f.calls.push(['list']);return [{...account,connected:false}];}});
  assert.equal((await f.helper.disconnect(account.connectionId,signal())).outcome,'disconnected');
  assert.deepEqual(f.calls,[['disconnect','owned-grant'],['list']]);
  assert.deepEqual(f.events,[GOOGLE_ACCOUNTS_CHANGED]);
});
test('lost disconnect response is read back without replaying the mutation',async()=>{
  const f=fixture({async disconnectGmail(id){f.calls.push(['disconnect',id]);throw Error('Response lost');},async gmailAccounts(){f.calls.push(['list']);return [];} });
  assert.equal((await f.helper.disconnect(account.connectionId,signal())).outcome,'disconnected');
  assert.equal(f.calls.filter(([kind])=>kind==='disconnect').length,1);
  assert.equal(f.events.length,1);
});
test('still-connected and unreadable results remain distinct and notify views to recheck',async()=>{
  const live=fixture();
  assert.equal((await live.helper.disconnect(account.connectionId,signal())).outcome,'still-connected');
  const failed=fixture({async gmailAccounts(){throw Error('Read unavailable');}});
  const result=await failed.helper.disconnect(account.connectionId,signal());
  assert.deepEqual(result,{outcome:'unconfirmed',accounts:null});
  assert.equal(live.events.length,1);assert.equal(failed.events.length,1);
});
for(const field of ['sessionId','credentialId','client'])test(`a changed ${field} prevents any request under a stale helper`,async()=>{
  const f=fixture();f.setCurrent({...f.captured,[field]:field==='client'?{...f.client}:'replacement'});
  await assert.rejects(f.helper.connect(signal()),{name:'AbortError'});
  await assert.rejects(f.helper.list(signal()),{name:'AbortError'});
  await assert.rejects(f.helper.disconnect(account.connectionId,signal()),{name:'AbortError'});
  assert.deepEqual(f.calls,[]);assert.deepEqual(f.events,[]);
});
for(const operation of ['list','connect'])test(`${operation} drops a result when the Cloud account changes during the request`,async()=>{
  const gate=deferred(),f=fixture(operation==='list'?{gmailAccounts:()=>gate.promise}:{initiateGoogle:()=>gate.promise});
  const result=f.helper[operation](signal());f.setCurrent(null);gate.resolve(operation==='list'?[account]:'https://accounts.google.com/synthetic');
  await assert.rejects(result,{name:'AbortError'});assert.deepEqual(f.events,[]);
});
test('a Cloud change during disconnect prevents readback with the replacement account and suppresses events',async()=>{
  const gate=deferred(),f=fixture({async disconnectGmail(id){f.calls.push(['disconnect',id]);await gate.promise;}});
  const result=f.helper.disconnect(account.connectionId,signal());f.setCurrent({...f.captured,sessionId:'replacement'});gate.resolve();
  await assert.rejects(result,{name:'AbortError'});
  assert.deepEqual(f.calls,[['disconnect','owned-grant']]);assert.deepEqual(f.events,[]);
});
test('a Cloud change during disconnect readback never publishes stale account status',async()=>{
  const gate=deferred(),entered=deferred(),f=fixture({gmailAccounts:()=>{entered.resolve();return gate.promise;}});
  const result=f.helper.disconnect(account.connectionId,signal());
  await entered.promise;f.setCurrent(null);gate.resolve([]);
  await assert.rejects(result,{name:'AbortError'});assert.deepEqual(f.events,[]);
});
test('abort and an empty connection ID cannot start a disconnect',async()=>{
  const f=fixture(),abort=new AbortController();abort.abort();
  await assert.rejects(f.helper.disconnect(account.connectionId,abort.signal),{name:'AbortError'});
  await assert.rejects(f.helper.disconnect(' ',signal()),TypeError);
  assert.deepEqual(f.calls,[]);
});
test('disconnect copy names the account, keeps personal data and stays short',()=>{
  const prompt=googleDisconnectConfirmation(account.label,'Nebula');
  assert.ok(prompt.startsWith(`Disconnect ${account.label}?\n\n`));
  assert.match(prompt,/Nebula/);assert.doesNotMatch(prompt,/Eliza/);assert.match(prompt,/Gmail/);assert.match(prompt,/Calendar/);
  assert.match(prompt,/Google account, mail and calendar events are not deleted/);
  assert.equal(googleDisconnectMessage('disconnected',account.label),`${account.label} disconnected.`);
  assert.equal(googleDisconnectMessage('still-connected',account.label),`${account.label} is still connected. Try again.`);
  assert.equal(googleDisconnectMessage('unconfirmed',account.label),`Couldn’t disconnect ${account.label}. Try again.`);
});
