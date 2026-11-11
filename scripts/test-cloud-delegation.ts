import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {readFile, mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import react from '@vitejs/plugin-react';
import {build} from 'vite';
import {startLoopback, stopLoopback} from './fixtures/loopback.ts';

const source = process.cwd();
const out = path.resolve(process.env.ALPHA_HOSTED_TEST_OUTPUT || 'test-results/cloud-delegation-browser');
const fixture = path.join(source, 'scripts/fixtures/cloud-delegation');
await mkdir(out, {recursive: true});
const browserModules = process.env.ALPHA_BROWSER_MODULES || path.join(source, 'node_modules');
const {chromium}: typeof import('playwright') = createRequire(path.join(browserModules, 'fixture.cjs'))('playwright');
await build({
 configFile: false, plugins: [react()], root: fixture,
 resolve: {alias: [
  {find: './native-connection', replacement: path.join(fixture, 'native.ts')},
  {find: '../native', replacement: path.join(fixture, 'native.ts')},
  {find: '@capacitor/core', replacement: path.join(fixture, 'capacitor.ts')},
 ]},
 build: {outDir: path.join(out, 'dist'), emptyOutDir: true}, logLevel: 'warn',
});
type Authorization = {owner: string; status: 'waiting' | 'failed' | 'complete' | 'finishing'};
const states = new Map<string, Authorization>();
const statusLog: {state: string; owner: string}[] = [];
let starts = 0, completions = 0, lose = true, revokeLost = true, repeatWaiting = false, waitingCompletions = 0;
let revokeOwner: string | null = null;
let revocations = 0;
let holdCompletion = false;
const completionGate: {entered?: () => void; release?: () => void} = {};
let lastKinds: string[] | null = null;
let startUrl: ((state: string) => string) | null = null;
let startExpires = 600000;
// Owner scopes have the 64-hex shape the Android slot policy admits.
const ownerA = 'a'.repeat(64), ownerB = 'b'.repeat(64), slotA = 'cloud-delegation:v1:' + ownerA, slotB = 'cloud-delegation:v1:' + ownerB;
const reads = (state: string) => statusLog.filter(row => row.state === state).length;
const stateFor = (id: string) => {
 const state = states.get(id);
 assert.ok(state, 'Expected the fixture authorization state');
 return state;
};
// A negative check must hold for a bounded settle window, not one macrotask.
async function quiet(leaked: () => boolean, message: string, ms = 200) {
 for (const end = Date.now() + ms; Date.now() < end; await sleep(10)) assert.ok(!leaked(), message);
}
function within<T>(promise: Promise<T>, message: string, ms = 12000) {
 let timer: ReturnType<typeof setTimeout>;
 const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(message)), ms); });
 return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
const server = http.createServer(async (req, res) => {
 const url = req.url ?? '';
 if (url.startsWith('/api/')) {
  let text = '';
  for await (const chunk of req) text += chunk;
  const body: {confirmed?: boolean; kinds: string[]; state: string; code?: string; grantId?: string} = text ? JSON.parse(text) : {};
  const owner = req.headers['x-fixture-owner'];
  assert.ok(typeof owner === 'string', 'Fixture API request names its owner');
  const reply = (value: unknown, status = 200) => {
   res.writeHead(status, {'content-type': 'application/json'});
   res.end(JSON.stringify(value));
  };
  if (url.endsWith('/live-accounts')) return reply({accounts: []});
  if (url.endsWith('/sources')) return reply({sources: []});
  if (url.endsWith('/loops')) return reply({loops: []});
  if (url.endsWith('/start')) {
   starts++;
   assert.equal(body.confirmed, true);
   lastKinds = body.kinds;
   const state = String(starts).padStart(43, 'a');
   states.set(state, {owner, status: 'waiting'});
   return reply({authUrl: startUrl?.(state) ?? 'https://cloud.invalid/app-auth/authorize?state=' + state,
    expiresAt: new Date(Date.now() + startExpires).toISOString()});
  }
  if (url.endsWith('/revocations')) return reply({grants: revokeOwner === owner
   ? [{grantId: 'fixture-grant', expiresAt: new Date(Date.now() + 60000).toISOString()}] : []});
  const state = states.get(body.state);
  if (url.endsWith('/status')) statusLog.push({state: body.state, owner});
  if (url.endsWith('/revoke')) {
   assert.equal(body.grantId, 'fixture-grant');
   assert.equal(body.confirmed, true);
   revocations++;
   if (revokeLost) {
    revokeLost = false;
    revokeOwner = owner;
    return reply({revoked: true, remoteRevocation: 'retry_required'});
   }
   revokeOwner = null;
   return reply({revoked: true, remoteRevocation: 'confirmed'});
  }
  if (!state || state.owner !== owner) return reply({}, 403);
  if (url.endsWith('/status')) return reply({status: state.status, grantId: 'fixture-grant'});
  if (url.endsWith('/cancel')) {
   state.status = 'failed';
   return reply({});
  }
  if (url.endsWith('/complete')) {
   assert.equal(body.code, 'fixture-code');
   completions++;
   if (holdCompletion) await new Promise<void>(resolve => {
    completionGate.release = resolve;
    completionGate.entered?.();
   });
   if (repeatWaiting) {
    waitingCompletions++;
    return waitingCompletions >= 4 ? reply({}, 503) : reply({grantId: 'fixture-grant'});
   }
   state.status = 'complete';
   if (lose) {
    lose = false;
    return reply({}, 503);
   }
   return reply({grantId: 'fixture-grant'});
  }
  return reply({}, 404);
 }
 try {
  const name = url === '/' ? 'index.html' : url.slice(1);
  if (name.includes('..')) throw Error('path');
  res.setHeader('content-type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(await readFile(path.join(out, 'dist', name)));
 } catch {
  res.writeHead(404);
  res.end();
 }
});
const serverOrigin = await startLoopback(server);
const browser = await chromium.launch({headless:true});

type StoredAuthorization = {state: string; authUrl: string; expiresAt: string; phase: string; code?: string};
try {
const page = await browser.newPage({viewport:{width:412,height:915}});
page.setDefaultTimeout(12000);
const stored = (slot: string): Promise<StoredAuthorization | null> =>
 page.evaluate(key=>JSON.parse(localStorage.getItem(key) ?? 'null'),slot);
const storedAuthorization = async () => {
 const record = await stored(slotA);
 assert.ok(record, 'Expected a retained authorization for the fixture owner');
 return record;
};
await page.goto(serverOrigin);await page.getByText('Cloud reads',{exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Refresh authorization status'}).waitFor();const latest = async (prior: string | null = null) => {
 await page.waitForFunction(previous => {
  const url = window.alphaCloudDelegationFixture.authorizationUrl;
  return typeof url === 'string' && url.startsWith('https:') && new URL(url).searchParams.get('state') !== previous;
 }, prior);
 const next = await page.evaluate(() => {
  const url = window.alphaCloudDelegationFixture.authorizationUrl;
  return url ? new URL(url).searchParams.get('state') : null;
 });
 assert.ok(next, 'Expected a browser authorization state');
 return next;
};
const state=await latest();await page.evaluate(s=>window.alphaCloudDelegationFixture.emitCallback({state:s,code:'fixture-code'}),state);await page.getByText('Unconfirmed',{exact:true}).waitFor();assert.equal(completions,1);assert.deepEqual(lastKinds,['email']);assert.equal(await page.evaluate(()=>window.alphaCloudDelegationFixture.storedCallback()),null,'A handled callback is cleared by its own state');await page.reload();await page.getByRole('button',{name:'Refresh authorization status'}).click();await page.getByText('Connected',{exact:true}).waitFor();assert.equal(completions,1);
const removal = page.getByRole('button', {name: 'Review Cloud read grant removal'});
await removal.click();
await page.getByRole('heading', {name: 'Remove Google access'}).waitFor();
await page.getByText('No saved sources use this access.').waitFor();
assert.equal(revocations, 0);
await page.getByRole('button', {name: 'Cancel removal'}).click();
await removal.click();
assert.equal(revocations, 0);
await page.getByRole('button', {name: 'Confirm removal'}).click();
await page.getByText('Off · retry', {exact:true}).waitFor();
assert.equal(revocations, 1);
await page.reload();await page.getByRole('button',{name:'Retry Cloud disconnect'}).click();await page.getByText('Revoked',{exact:true}).waitFor();await page.getByRole('button',{name:'Continue',exact:true}).click();const second=await latest(state);await page.evaluate(o=>window.alphaCloudDelegationFixture.switchOwner(o),ownerB);await page.locator('[data-fixture-owner="'+ownerB+'"]').waitFor();await page.evaluate(s=>window.alphaCloudDelegationFixture.emitCallback({state:s,code:'fixture-code'}),second);await quiet(()=>completions!==1,'A foreign owner without a pending grant must not complete the callback');assert.equal((await page.evaluate(()=>window.alphaCloudDelegationFixture.storedCallback()))?.state,second,'The rightful owner must retain its callback');assert.equal(completions,1);await page.evaluate(o=>window.alphaCloudDelegationFixture.switchOwner(o),ownerA);await page.getByText('Connected',{exact:true}).waitFor();assert.equal(completions,2);// A stale/repeated waiting observation must not loop completion in one UI action.
repeatWaiting=true;await page.getByRole('button',{name:'Continue',exact:true}).click();const third=await latest(second);await page.evaluate(s=>window.alphaCloudDelegationFixture.emitCallback({state:s,code:'fixture-code'}),third);const check=page.getByRole('button',{name:'Refresh authorization status'});await check.waitFor();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='Refresh authorization status')?.disabled);assert.equal(waitingCompletions,1,'One recovery action must never loop completion after repeated waiting');assert.equal(reads(third),2,'Completion is followed by exactly one read-only status');
await page.getByText('Unconfirmed',{exact:true}).waitFor();await check.click();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='Refresh authorization status')?.disabled);assert.equal(waitingCompletions,2,'An explicit check may complete only once after a fresh authoritative waiting status');assert.equal(reads(third),4);
const retained=await storedAuthorization();assert.equal(retained.state,third);assert.equal(retained.code,'fixture-code');assert.equal(retained.phase,'finishing');stateFor(third).status='finishing';await page.reload();await page.getByRole('button',{name:'Refresh authorization status'}).click();await page.getByText('Finishing…',{exact:true}).waitFor();assert.equal(waitingCompletions,2);stateFor(third).status='complete';await page.getByRole('button',{name:'Refresh authorization status'}).click();await page.getByText('Connected',{exact:true}).waitFor();assert.equal(waitingCompletions,2);assert.equal(await stored(slotA),null);
// An account switch while completion is in flight must not continue recovery.
waitingCompletions=0;holdCompletion=true;await page.getByRole('button',{name:'Continue',exact:true}).click();const fourth=await latest(third);const held=new Promise<void>(resolve=>{completionGate.entered=resolve;});await page.evaluate(s=>window.alphaCloudDelegationFixture.emitCallback({state:s,code:'fixture-code'}),fourth);await within(held,'Completion never reached Cloud');const readsBeforeSwitch=reads(fourth);await page.evaluate(o=>window.alphaCloudDelegationFixture.switchOwner(o),ownerB);const completedResponse=page.waitForResponse(r=>r.url().endsWith('/complete'));holdCompletion=false;assert.ok(completionGate.release);completionGate.release();await completedResponse;await quiet(()=>reads(fourth)!==readsBeforeSwitch,'The retired owner must not read status after its completion returns');assert.equal(statusLog.some(r=>r.state===fourth&&r.owner===ownerB),false);assert.equal(waitingCompletions,1);assert.equal((await storedAuthorization()).state,fourth);stateFor(fourth).status='complete';await page.evaluate(o=>window.alphaCloudDelegationFixture.switchOwner(o),ownerA);await page.getByRole('button',{name:'Refresh authorization status'}).click();await page.getByText('Connected',{exact:true}).waitFor();assert.equal(waitingCompletions,1);
// A matching denied callback cancels only its pending authorization.
repeatWaiting=false;await page.getByRole('button',{name:'Continue',exact:true}).click();const fifth=await latest(fourth),priorCompletions=completions;await page.evaluate(s=>window.alphaCloudDelegationFixture.emitCallback({state:s,error:'access_denied'}),fifth);await page.getByText('Cancelled',{exact:true}).waitFor();assert.equal(stateFor(fifth).status,'failed');assert.equal(completions,priorCompletions);assert.equal(await stored(slotA),null);
// Hold secure CAS clearing after authoritative success, then replace the owner.
await page.getByRole('button',{name:'Continue',exact:true}).click();const sixth=await latest(fifth);const connectedBefore=await page.evaluate(()=>window.alphaCloudDelegationFixture.connected||0);await page.evaluate(()=>window.alphaCloudDelegationFixture.holdClear=true);await page.evaluate(s=>window.alphaCloudDelegationFixture.emitCallback({state:s,code:'fixture-code'}),sixth);await page.waitForFunction(()=>typeof window.alphaCloudDelegationFixture.releaseClear==='function');await page.evaluate(o=>window.alphaCloudDelegationFixture.switchOwner(o),ownerB);await page.evaluate(()=>{window.alphaCloudDelegationFixture.holdClear=false;window.alphaCloudDelegationFixture.releaseClear?.();});await page.waitForFunction(key=>localStorage.getItem(key)===null,slotA);const connectedAfter=()=>page.evaluate(()=>window.alphaCloudDelegationFixture.connected||0);for(const end=Date.now()+200;Date.now()<end;await sleep(10))assert.equal(await connectedAfter(),connectedBefore,'Retired owner must not publish onConnected after secure clear');assert.equal(await page.getByText('Connected',{exact:true}).count(),0);assert.equal(await stored(slotB),null);
// Panel guards against stale callbacks, bad authorization links, expiry, Cloud failure and storage races.
const review=page.getByRole('button',{name:'Continue',exact:true}),open=()=>page.evaluate(()=>{const panel = document.querySelector<HTMLDetailsElement>('details.alpha-cloud-delegation');
 if (!panel) throw Error('Missing delegation panel');
 panel.open = true;}),opened=()=>page.evaluate(()=>window.alphaCloudDelegationFixture.opened||0);
const refused=async()=>{const before=starts;await review.click();for(const end=Date.now()+12000;starts===before&&Date.now()<end;)await sleep(10);assert.equal(starts,before+1);await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Continue')?.disabled);await page.getByText('Unconfirmed',{exact:true}).waitFor();};
await page.evaluate(o=>window.alphaCloudDelegationFixture.switchOwner(o),ownerA);await open();await page.getByLabel('Inbox',{exact:true}).uncheck();await page.getByLabel('Calendar',{exact:true}).check();await review.click();const seventh=await latest(sixth);assert.deepEqual(lastKinds,['calendar']);let settled=completions;const waiting=await storedAuthorization();
await page.evaluate(s=>window.alphaCloudDelegationFixture.emitCallback({state:s,code:'fixture-code'}),second);await page.getByText('Wrong account',{exact:true}).waitFor();await quiet(()=>completions!==settled,'An older same-owner callback must not complete the pending grant');assert.equal(waiting.state,seventh);assert.deepEqual(await stored(slotA),waiting);
let launches=await opened();await page.getByRole('button',{name:'Open authorization'}).click();await page.waitForFunction(n=>window.alphaCloudDelegationFixture.opened===n+1,launches);await page.getByRole('button',{name:'Cancel authorization'}).click();await page.getByText('Cancelled',{exact:true}).waitFor();assert.equal(stateFor(seventh).status,'failed');assert.equal(await stored(slotA),null);
for(const bad of [(s: string)=>'http://cloud.invalid/app-auth/authorize?state='+s,(s: string)=>'https://cloud.invalid/oauth/authorize?state='+s,()=>'https://cloud.invalid/app-auth/authorize?state=short']){startUrl=bad;launches=await opened();await refused();assert.equal(await stored(slotA),null,'An invalid authorization link must not be stored');assert.equal(await opened(),launches,'An invalid authorization link must not open');}startUrl=null;
startExpires=-1000;await review.click();const eighth=await latest(seventh);startExpires=600000;settled=completions;await page.evaluate(s=>window.alphaCloudDelegationFixture.emitCallback({state:s,code:'fixture-code'}),eighth);await page.getByText('Expired',{exact:true}).waitFor();await quiet(()=>completions!==settled,'An expired authorization must not complete');assert.equal((await storedAuthorization()).code,undefined);
stateFor(eighth).status='failed';await page.getByRole('button',{name:'Refresh authorization status'}).click();await page.getByText('Ended',{exact:true}).waitFor();
for(const end=Date.now()+12000;await stored(slotA)!==null&&Date.now()<end;)await sleep(10);assert.equal(await stored(slotA),null);
const foreign={state:'f'.repeat(43),authUrl:'https://cloud.invalid/app-auth/authorize?state='+'f'.repeat(43),expiresAt:new Date(Date.now()+600000).toISOString(),phase:'waiting'};await page.evaluate(([k,v])=>localStorage.setItem(k,JSON.stringify(v)),[slotA,foreign] as const);launches=await opened();await refused();assert.deepEqual(await stored(slotA),foreign,'A start that loses the slot race must not overwrite it');assert.equal(await opened(),launches);await page.evaluate(k=>localStorage.removeItem(k),slotA);
await review.click();const ninth=await latest(eighth);settled=completions;await page.evaluate(([k,later])=>{window.alphaCloudDelegationFixture.raceExchange=()=>localStorage.setItem(k,JSON.stringify({...JSON.parse(localStorage.getItem(k) ?? 'null'),expiresAt:later}));},[slotA,new Date(Date.now()+900000).toISOString()]);await page.evaluate(s=>window.alphaCloudDelegationFixture.emitCallback({state:s,code:'fixture-code'}),ninth);await page.getByText('Unconfirmed',{exact:true}).waitFor();await quiet(()=>completions!==settled,'A callback that loses the slot race must not complete');assert.equal((await storedAuthorization()).code,undefined);assert.equal((await page.evaluate(()=>window.alphaCloudDelegationFixture.storedCallback()))?.state,ninth,'A callback that was not handled stays stored');
await page.screenshot({path:path.join(out,'cloud-delegation.png'),fullPage:true});console.log('PASS callback, stale-state, invalid-link, expiry, failed-status and slot-race guards, calendar kind, response-loss/reload recovery, bounded repeated-waiting completion, explicit status recovery, finishing without replay, in-flight owner switch isolation, denied callback cancellation, and reviewed revoke retry after reload. Native Keystore and Android intent acceptance are separate.');}finally{await browser.close();server.closeAllConnections();await stopLoopback(server);}
