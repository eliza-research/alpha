// Compile the whole OwnerRoutes request gate and pinned shared OwnerRoutePolicy against the real
// product table. Renderer parity covers claimed owner groups; native-only conversation reads and
// UTF8 body admission execute separately. Transport owner/epoch/stream lifecycle and Android remain external.
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {root,runJvm,nativeSource,upstreamConnection,fixture,jvmSkip} from './fixtures/jvm-tools.mjs';
import {build} from 'esbuild';
import {OWNER_ROUTE_TABLE,serializeOwnerRouteTable} from '../apps/app/src/product/owner-route-table.ts';
import {loadBrowserModule} from './fixtures/browser-source.mjs';
const [{ownerRouteGroup,ownerRouteAllowed}]=await loadBrowserModule(['apps/app/src/runtime/owner-route-policy.ts'],{testMocks:true});

// Tables that cannot load: missing, empty, malformed, an invalid pattern, an {id} route in a group without an id pattern.
const shippedTable=serializeOwnerRouteTable(),edited=edit=>{const table=JSON.parse(shippedTable);edit(table);return JSON.stringify(table);};
const brokenTables=[
 ['empty',''],['malformed','{"unsafe":'],['missing groups','{"unsafe":"#"}'],
 ['invalid unsafe pattern',edited(table=>{table.unsafe='[';})],['invalid id pattern',edited(table=>{table.groups.automations.id='(';})],
 ['{id} route without an id pattern',edited(table=>{delete table.groups.automations.id;})],
];
test('the renderer interpreter fails to load every owner route table the Android gate cannot load',async()=>{
 const load=table=>build({entryPoints:[join(root,'apps/app/src/runtime/owner-route-policy.ts')],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',
  plugins:[{name:'owner-routes',setup(builder){builder.onLoad({filter:/owner-route-table\.ts$/},()=>({contents:'export const OWNER_ROUTE_TABLE = '+table,loader:'ts'}));}}]})
  .then(({outputFiles})=>import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64')));
 assert.equal(typeof (await load(shippedTable)).ownerRouteAllowed,'function');
 for(const [name,table] of brokenTables)await assert.rejects(load(table),undefined,name);
});

test('the renderer refuses unknown owner route group names',()=>{
 assert.throws(()=>ownerRouteGroup('/api/triggers','automations','nope'),/Unknown owner route group nope/);
 assert.throws(()=>ownerRouteAllowed('nope','/api/triggers','POST'),/Unknown owner route group nope/);
});

const nativeSources=[nativeSource('OwnerRoutes.java'),upstreamConnection('OwnerRoutePolicy.java'),fixture('OwnerRoutesTest.java')];
const request=(name,path,method='GET',owner='owner',expected=true,body)=>({name,path,method,owner,expected,...(body===undefined?{}:{body})});
const uuid='11111111-2222-4333-8444-555555555555';
const nativeCases=[];
for(const [group,entry] of Object.entries(OWNER_ROUTE_TABLE.groups))for(const route of entry.routes)for(const path of route.paths)for(const method of route.methods){
 const resolved=path.replaceAll('{id}',group==='approvals'?uuid:'entry-1');
 nativeCases.push(request(`${group} ${method} ${resolved}`,resolved,method,'owner',true,['GET','DELETE'].includes(method)?undefined:'{}'));
 nativeCases.push(request(`${group} refuses absent owner ${method} ${resolved}`,resolved,method,null,false));
}
const search='/api/conversations/messages/search?q=Alice%20Example%2F%26%F0%9F%98%80&limit=50&offset=0';
nativeCases.push(
 request('fork owner POST','/api/conversations/room/fork','POST','owner',true,'{}'),
 request('fork rejects GET','/api/conversations/room/fork','GET','owner',false),
 request('fork needs owner','/api/conversations/room/fork','POST',null,false,'{}'),
 request('ordinary status GET','/api/status','GET',null),
 request('ordinary conversation POST','/api/conversations','POST','owner',true,'{}'),
 request('ordinary message GET','/api/conversations/room/messages'),
 request('ordinary message POST','/api/conversations/room/messages','POST','owner',true,'{}'),
 request('dedicated stream is not generic request','/api/conversations/room/messages/stream','POST','owner',false,'{}'),
 request('encoded owner-bound search',search),
 request('search needs owner',search,'GET',null,false),
 request('search needs nonblank owner',search,'GET','  ',false),
 request('search refuses POST',search,'POST','owner',false),
 request('search refuses GET body',search,'GET','owner',false,'{}'),
 request('around exact UUID',`/api/conversations/room/messages?around=${uuid}`),
 request('around needs owner',`/api/conversations/room/messages?around=${uuid}`,'GET',null,false),
 request('around refuses wrong method',`/api/conversations/room/messages?around=${uuid}`,'POST','owner',false),
 request('around refuses invalid UUID length','/api/conversations/room/messages?around=not-a-uuid','GET','owner',false),
 request('around refuses added parameters',`/api/conversations/room/messages?around=${uuid}&owner=other`,'GET','owner',false),
 request('search refuses raw space','/api/conversations/messages/search?q=Alice Example&limit=50&offset=0','GET','owner',false),
 request('search refuses malformed escape','/api/conversations/messages/search?q=%GG&limit=50&offset=0','GET','owner',false),
 request('search refuses duplicate query','/api/conversations/messages/search?q=a&q=b&limit=50&offset=0','GET','owner',false),
 request('search refuses altered limit','/api/conversations/messages/search?q=a&limit=500&offset=0','GET','owner',false),
 request('search refuses injection','/api/conversations/messages/search?q=a#fragment&limit=50&offset=0','GET','owner',false),
 request('traversal','/api/conversations/../messages','GET','owner',false),
 request('encoded traversal path','/api/conversations/%2e%2e/messages','GET','owner',false),
 request('backslash path','/api/conversations/room\\messages','GET','owner',false),
 request('newline path','/api/status\n','GET','owner',false),
 request('unrecognized owner-group route','/api/triggers/entry-1/unknown','POST','owner',false),
 request('view navigation needs owner','/api/views/chat/navigate','POST',null,false,'{}'),
 request('truncate needs owner','/api/conversations/room/messages/truncate','POST',null,false,'{}'),
 request('ordinary wrong method','/api/status','PUT','owner',false),
 request('ordinary GET body','/api/status','GET','owner',false,'{}'),
 request('delete body denied','/api/triggers/entry-1','DELETE','owner',false,'{}'),
 request('missing path',null,'GET','owner',false),
 request('missing method','/api/status',null,'owner',false),
);
for(const [name,path,method,char,count,expected] of [
 ['ordinary exact2MiB','/api/conversations','POST','a',2*1024*1024,true],
 ['ordinary above2MiB','/api/conversations','POST','a',2*1024*1024+1,false],
 ['ordinary UTF8 overflow','/api/conversations','POST','é',1024*1024+1,false],
 ['chat exact20MiB','/api/conversations/room/messages','POST','a',20*1024*1024,true],
 ['chat above20MiB','/api/conversations/room/messages','POST','a',20*1024*1024+1,false],
 ['chat UTF8 exact20MiB','/api/conversations/room/messages','POST','😀',5*1024*1024,true],
 ['chat UTF8 overflow','/api/conversations/room/messages','POST','😀',5*1024*1024+1,false],
 ['chat cap does not widen truncation','/api/conversations/room/messages/truncate','POST','a',2*1024*1024+1,false],
])nativeCases.push({...request(name,path,method,'owner',expected),repeat:char,count});

test('whole native owner gate preserves group parity, read authority and UTF8 body limits',{skip:jvmSkip('json','javac')},()=>{
 const {results}=JSON.parse(runJvm(nativeSources,'ai.alphacompute.alphaphone.OwnerRoutesTest',{json:true,input:JSON.stringify({table:shippedTable,cases:nativeCases})}));
 assert.equal(results.length,nativeCases.length);
 for(let i=0;i<results.length;i++){
  const item=nativeCases[i],actual=results[i];
  assert.equal(actual.group,ownerRouteGroup(item.path)??null,item.name);
  if(actual.group!==null)assert.equal(actual.policyAllowed,ownerRouteAllowed(actual.group,item.path,item.method),item.name);
 }
 assert.equal(results.find(row=>row.name==='dedicated stream is not generic request').limit,20*1024*1024);
 assert.equal(results.find(row=>row.name==='chat cap does not widen truncation').limit,2*1024*1024);
 const directory=join(root,'test-results/current-chat-intake');mkdirSync(directory,{recursive:true});
 const sources=[...nativeSources,join(root,'apps/app/src/product/owner-route-table.ts'),join(root,'apps/app/src/runtime/owner-route-policy.ts'),join(root,'test/owner-route-parity.test.mjs')];
 writeFileSync(join(directory,'owner-routes-jvm.json'),JSON.stringify({scope:'Whole OwnerRoutes and pinned real OwnerRoutePolicy on host JVM; renderer group parity; transport/stream lifecycle, Android and device acceptance excluded',tableSHA256:createHash('sha256').update(shippedTable).digest('hex'),sources:Object.fromEntries(sources.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')])),caseCount:results.length,results},null,2)+'\n');
});

test('whole native gate refuses malformed shipped owner tables',{skip:jvmSkip('json','javac')},()=>{
 for(const [name,table] of brokenTables)assert.match(runJvm(nativeSources,'ai.alphacompute.alphaphone.OwnerRoutesTest',{json:true,input:JSON.stringify({table,refuseTable:true})}),/refused table/,name);
});
