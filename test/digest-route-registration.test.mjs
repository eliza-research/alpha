import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
// Every hosted digest path the app calls must be one the pinned agent registers. plugin-workflow's
// handleWorkflowRoutes knows its /hosted/* paths, but a request reaches it only through a route in
// plugin-routes.ts, or through a packages/app route-auth prefix (cloud-delegation). The upstream
// integration tests call the handler directly, so a path that is handled but never registered passes
// there and fails on a real agent. Read at the upstream.lock.json commit, never the working tree.
const root=resolve(import.meta.dirname,'..');
const pin=JSON.parse(readFileSync(resolve(root,'upstream.lock.json'),'utf8')).commit;
const show=path=>execFileSync('git',['-C',resolve(root,'vendor/eliza'),'show',`${pin}:${path}`],{encoding:'utf8',maxBuffer:16*1024*1024});

/** Method and path of every request HostedDigestProtocol can make (the app transport sends GET without a body). */
const script=`
const d=await import(${JSON.stringify(resolve(root,'apps/app/src/runtime/hosted-digests.ts'))});
const calls=[],signal=new AbortController().signal;
const p=new d.HostedDigestProtocol(async(path,body)=>{calls.push((body===undefined?'GET ':'POST ')+path.split('?')[0]);throw Error('recorded');});
const attempt=async run=>{try{await run();}catch{}};
await attempt(()=>p.capabilities(signal));await attempt(()=>p.available(signal));
for(const path of ['start','complete','status','cancel','revoke','revocations'])await attempt(()=>p.delegation(path,{},signal));
await attempt(()=>p.liveAccounts(signal));await attempt(()=>p.liveCalendars({accountId:'a',accountRevision:'r'},signal));
await attempt(()=>p.sources(signal));await attempt(()=>p.loops(signal));
for(const path of ['sources','loops','sources/revoke','dossier'])await attempt(()=>p.mutate(path,{},signal));
await attempt(()=>p.results('client',signal));await attempt(()=>p.ack('client',{cursor:1,runId:'run'},signal));
console.log(JSON.stringify([...new Set(calls)]));`;
const appCalls=()=>JSON.parse(execFileSync(process.execPath,['--import=tsx','--input-type=module','-e',script],{cwd:root,encoding:'utf8',timeout:60000}));

test('the protocol under test is the whole set of hosted paths the app source names', () => {
  // The app's protocol is the shared upstream client, staged from the pin (scripts/prepare-client-features.mjs).
  const source=readFileSync(resolve(root,'.eliza/client-features/plugins/plugin-workflow/src/client/hosted-digests.ts'),'utf8');
  assert.match(readFileSync(resolve(root,'apps/app/src/runtime/hosted-digests.ts'),'utf8'),/export \* from '[./]+\.eliza\/client-features\/plugins\/plugin-workflow\/src\/client\/hosted-digests\.ts';/);
  // The enumerations above must cover every mutate and delegation path the source allows.
  assert.match(source,/export type HostedDigestMutationPath = 'sources' \| 'loops' \| 'sources\/revoke' \| 'dossier';/);
  assert.match(source,/export type HostedDigestDelegationPath =\s*\| 'start'\s*\| 'complete'\s*\| 'status'\s*\| 'cancel'\s*\| 'revoke'\s*\| 'revocations';/);
  const literals=[...source.matchAll(/["'](\/api\/workflow\/hosted\/[^"'?]*)/g)].map(match=>match[1]).filter(path=>!path.endsWith('/'));
  const called=appCalls().map(call=>call.split(' ')[1]);
  for(const path of literals)assert.ok(called.includes(path),`${path} is exercised`);
});

test('every hosted digest route the app calls is registered by the pinned agent, including the dossier', () => {
  const routes=show('plugins/plugin-workflow/src/plugin-routes.ts');
  const registered=new Set([...routes.matchAll(/type:\s*'(GET|POST|PUT|PATCH|DELETE)',\s*path:\s*'([^']+)'/g)].map(([,method,path])=>`${method} ${path}`));
  assert.ok(registered.has('GET /api/workflow/status'),'the route table was parsed');
  // packages/app owns its own prefixes (session-authenticated) ahead of the plugin routes.
  const policy=show('packages/app/src/api/route-auth-policy.ts');
  const prefixes=[...new Set([...policy.matchAll(/["'](\/api\/workflow\/hosted\/[^"']*\/)["']/g)].map(match=>match[1]))];
  assert.deepEqual(prefixes,['/api/workflow/hosted/cloud-delegation/'],'route-auth-policy prefixes under hosted/');
  const unregistered=appCalls().filter(call=>call.includes('/api/workflow/hosted/')&&!registered.has(call)&&!prefixes.some(prefix=>call.split(' ')[1].startsWith(prefix)));
  // elizaOS/eliza#35906 registered POST /hosted/dossier; the resident renderer offers the dossier on that
  // basis (digest-capabilities.test.mjs). A pin without it must fail here.
  assert.deepEqual(unregistered,[]);
  assert.ok(registered.has('POST /api/workflow/hosted/dossier'),'the pinned agent registers the dossier route');
  const dossier=routes.slice(routes.indexOf("path: '/api/workflow/hosted/dossier'"));
  assert.match(dossier.slice(0,600),/2000|2_000/,'the dossier route keeps the handler\'s 2000-byte body cap');
  const handler=show('plugins/plugin-workflow/src/routes/workflow-routes.ts');
  assert.match(handler,/'\/hosted\/dossier'/,'the handler itself knows the dossier path');
});
