// Owner-bound renderer routes (config/owner-routes.json). The real Android request gate is compiled from
// AlphaLocalAgentPlugin.java with OwnerRoutes.java and run on the host JVM over a broad case table next to the
// renderer interpreter (owner-route-policy.ts): both must claim and admit the same requests, and exactly what the
// hand-mirrored gates admitted before the table. Host-JVM and Node evidence only, not Android.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeSource,runJvm,jsonJarSkip,root,upstreamConnection} from './fixtures/jvm-tools.mjs';
import {build} from 'esbuild';
import {loadBrowserModule} from './fixtures/browser-source.mjs';
const [{ownerRouteGroup,ownerRouteAllowed}]=await loadBrowserModule(['apps/app/src/runtime/owner-route-policy.ts'],{testMocks:true});

const C='/api/lifeops/calendar',E=C+'/events/',F=C+'/feed?',T='/api/lifeops/scheduled-tasks',A='/api/approvals?state=all&limit=500';
const paths=[
 // Notes
 '/api/notes/state','/api/notes/state?','/api/notes/state?&','/api/notes/state?x=1','/api/notes/state/','/api/notes/state/x','/api/notes/state#','/api/notes','/api/notes/stat','/api/notes/state\n',
 '/api/views/notes/interact','/api/views/notes/interact?','/api/views/notes/interact?a','/api/views/notes/interact/x','/api/views/interact-claim','/api/views/interact-result',
 // Calendar reads: query keys, duplicates, encodings, whitespace and dot segments
 C,C+'?',C+'/',C+'/feed',C+'/feed?',C+'/calendars?includeHiddenCalendars=true',C+'/next-context',C+'/next-context?forceSync=1',
 F+'side=owner&timeMin=2026-10-25T00%3A00%3A00Z&timeMax=2026-10-26T00%3A00%3A00Z&timeZone=Europe%2FBerlin',
 F+'mode=a&side=b&grantId=c&calendarId=d&includeHiddenCalendars=true&timeMin=1&timeMax=2&timeZone=UTC&forceSync=1',
 F+'side=owner&side=owner',F+'side=a&sid%65=b',F+'mod%65=x',F+'side',F+'=x',F+'&',F+'side=a&&mode=b',F+'side=a&',F+'unknown=1',
 F+'side=a?b',F+'side=%zz',F+'side=%2',F+'side=%E2%82',F+'side=a+b',F+'si+de=a',F+'side= ',F+'side= ',F+'side=%zz\u0085',F+'side=\u0085',
 F+'side=　',F+'side=﻿',F+'side=\u001c',F+'side=\u0001',F+'side=é',F+'side=a%20b',F+'side= x',F+'side=a\tb',F+'side=..',F+'side=../x',F+'timeZone=Europe/Berlin',
 F+'recurrenceScope=instance',F+'side='+'x'.repeat(2100),
 C+'/feed/',C+'/feed/x',C+'//feed',C+'/./feed',C+'/../notes/state',C+'/feed/..',C+'/feed/.',C+'/%66eed',C+'/FEED',C+'/feed#x',C+'/feed\\x',C+'/feed x',C+'/feed?a=1?b=2',
 // Calendar writes and event ids
 C+'/events',C+'/events?',C+'/events?mode=a',C+'/events/',C+'/events/x/extra',
 ...['x','eliza-1','grant%3Aevent-1','grant:event-1','a..b','a.b','a@b','a+b','a%2Bb','%41bc','%2Fetc','a%2','%2e%2e','..','.','x/..','x/.','-x','_x','.x','x/y','x%2Fy','a%C0','a%00','a b','x'.repeat(512),'x'.repeat(513),'é','%C3%A9','a%2e%2e'].map(id=>E+id),
 E+'x?mode=a',E+'x?recurrenceScope=instance&idempotencyKey=k',E+'x?cancellationMode=a',E+'x?mode=a&mode=b',E+'x?unknown=1',E+'x%3Fmode=a',E+'grant%3Aevent-1?side=owner&calendarId=primary',
 // Automations: exact routes, the exact-query route, actions and ids
 '/api/automations','/api/automations/','/api/automations?','/api/automations?x=1','/api/automations/x','/api/automationsx','/api/lifeops','/api/lifeopsx','/api/lifeops/reminders','/api/lifeops/reminders?',
 T,T+'?ownerVisibleOnly=1',T+'?ownerVisibleOnly=0',T+'?ownerVisibleOnly=1&ownerVisibleOnly=1',T+'?ownerVisibleOnly=%31',T+'/t1',T+'/t1/',T+'/t1?',
 ...['snooze','skip','complete','dismiss','escalate','acknowledge','edit','reopen','fire','delete','runs'].map(action=>T+'/t1/'+action),
 '/api/lifeops/occurrences/o1/snooze','/api/lifeops/occurrences/o1/skip','/api/lifeops/occurrences/o1','/api/lifeops/definitions','/api/lifeops/definitions/','/api/lifeops/definitions/d1','/api/lifeops/definitions/d1/x',
 '/api/triggers','/api/triggers/','/api/triggers?','/api/triggers/tr1','/api/triggers/tr1/runs','/api/triggers/tr1/execute','/api/triggers/tr1/runs/x','/api/triggers/tr1/runs?',
 ...['a..b','a.b','a:b','a%62','%74r1','a@b','a+b','-a','x'.repeat(200),'x'.repeat(201),'.','..','a b','a ','a\u001c','a ','a\u0085','é','x?','x#','x\\y','/x','./x','x/../y','x/./runs'].map(id=>'/api/triggers/'+id),
 '/api/%74riggers/x','/api/TRIGGERS/x','/api/triggers/x\n','/api/lifeops/definitions/a..b',
 // Approvals
 A,'/api/approvals','/api/approvals?',A+'&x=1','/api/approvals?limit=500&state=all',A.replace('500','501'),'/api/approvals/execute','/api/approvals/x?state=all&limit=500','https://example.invalid'+A,A+'#',
 // Unclaimed routes the generic gate decides
 '/api/conversations','/api/conversations/c1/messages?before=1','/api/conversations/c1/messages/truncate','/api/status','/api/auth/me','/api/unknown','','api/notes/state','//api/notes/state',
];
const methods=['GET','POST','PUT','PATCH','DELETE','HEAD','get'],bodyless=method=>['GET','DELETE','HEAD','get'].includes(method);
const variants=[['',bodyless],['flipped body',m=>!bodyless(m)],['no owner',bodyless,null],['empty owner',bodyless,''],['blank owner',bodyless,' ']];
const cases=paths.flatMap(path=>methods.flatMap(method=>variants.map(([label,empty,owner='owner-identity'])=>({label,path,method,owner,body:empty(method)?null:'{}'}))));

// Snapshot of the hand-mirrored gate (AppRecordRoutes, AutomationsRoutes, calendarApprovalReadAllowed) at a8d3a7ff,
// computed by running it over this case table: every request it admitted, by path, as the method plus the variant.
// It refused every other case.
const admittedBefore=new Map([
 ['/api/notes/state',['GET']],
 ['/api/views/notes/interact',['POST','POST flipped body']],
 ['/api/views/interact-claim',['POST','POST flipped body']],
 ['/api/views/interact-result',['POST','POST flipped body']],
 ['/api/lifeops/calendar/feed',['GET']],
 ['/api/lifeops/calendar/feed?',['GET']],
 ['/api/lifeops/calendar/calendars?includeHiddenCalendars=true',['GET']],
 ['/api/lifeops/calendar/next-context',['GET']],
 ['/api/lifeops/calendar/next-context?forceSync=1',['GET']],
 ['/api/lifeops/calendar/feed?side=owner&timeMin=2026-10-25T00%3A00%3A00Z&timeMax=2026-10-26T00%3A00%3A00Z&timeZone=Europe%2FBerlin',['GET']],
 ['/api/lifeops/calendar/feed?mode=a&side=b&grantId=c&calendarId=d&includeHiddenCalendars=true&timeMin=1&timeMax=2&timeZone=UTC&forceSync=1',['GET']],
 ['/api/lifeops/calendar/feed?mod%65=x',['GET']],
 ['/api/lifeops/calendar/feed?side',['GET']],
 ['/api/lifeops/calendar/feed?side=%E2%82',['GET']],
 ['/api/lifeops/calendar/feed?side=a+b',['GET']],
 ['/api/lifeops/calendar/feed?side=\u00a0',['GET']],
 ['/api/lifeops/calendar/feed?side=\u2028',['GET']],
 ['/api/lifeops/calendar/feed?side=%zz\u0085',['GET']],
 ['/api/lifeops/calendar/feed?side=\u0085',['GET']],
 ['/api/lifeops/calendar/feed?side=\u3000',['GET']],
 ['/api/lifeops/calendar/feed?side=\ufeff',['GET']],
 ['/api/lifeops/calendar/feed?side=\u001c',['GET']],
 ['/api/lifeops/calendar/feed?side=\u0001',['GET']],
 ['/api/lifeops/calendar/feed?side=\u00e9',['GET']],
 ['/api/lifeops/calendar/feed?side=a%20b',['GET']],
 ['/api/lifeops/calendar/feed?side=..',['GET']],
 ['/api/lifeops/calendar/feed?side=../x',['GET']],
 ['/api/lifeops/calendar/feed?timeZone=Europe/Berlin',['GET']],
 ['/api/lifeops/calendar/events',['POST','POST flipped body']],
 ['/api/lifeops/calendar/events?',['POST','POST flipped body']],
 ['/api/lifeops/calendar/events/x',['PATCH','PATCH flipped body','DELETE']],
 ['/api/lifeops/calendar/events/eliza-1',['PATCH','PATCH flipped body','DELETE']],
 ['/api/lifeops/calendar/events/grant%3Aevent-1',['PATCH','PATCH flipped body','DELETE']],
 ['/api/lifeops/calendar/events/grant:event-1',['PATCH','PATCH flipped body','DELETE']],
 ['/api/lifeops/calendar/events/a..b',['PATCH','PATCH flipped body','DELETE']],
 ['/api/lifeops/calendar/events/a.b',['PATCH','PATCH flipped body','DELETE']],
 ['/api/lifeops/calendar/events/a@b',['PATCH','PATCH flipped body','DELETE']],
 ['/api/lifeops/calendar/events/a+b',['PATCH','PATCH flipped body','DELETE']],
 ['/api/lifeops/calendar/events/a%2Bb',['PATCH','PATCH flipped body','DELETE']],
 ['/api/lifeops/calendar/events/%41bc',['PATCH','PATCH flipped body','DELETE']],
 ['/api/lifeops/calendar/events/'+'x'.repeat(512),['PATCH','PATCH flipped body','DELETE']],
 ['/api/lifeops/calendar/events/a%2e%2e',['PATCH','PATCH flipped body','DELETE']],
 ['/api/lifeops/calendar/events/x?mode=a',['PATCH','PATCH flipped body','DELETE']],
 ['/api/lifeops/calendar/events/x?recurrenceScope=instance&idempotencyKey=k',['DELETE']],
 ['/api/lifeops/calendar/events/x?cancellationMode=a',['DELETE']],
 ['/api/lifeops/calendar/events/grant%3Aevent-1?side=owner&calendarId=primary',['PATCH','PATCH flipped body','DELETE']],
 ['/api/automations',['GET']],
 ['/api/lifeops/reminders',['GET']],
 ['/api/lifeops/scheduled-tasks?ownerVisibleOnly=1',['GET']],
 ['/api/lifeops/scheduled-tasks/t1',['GET']],
 ['/api/lifeops/scheduled-tasks/t1/snooze',['POST','POST flipped body']],
 ['/api/lifeops/scheduled-tasks/t1/skip',['POST','POST flipped body']],
 ['/api/lifeops/scheduled-tasks/t1/complete',['POST','POST flipped body']],
 ['/api/lifeops/scheduled-tasks/t1/dismiss',['POST','POST flipped body']],
 ['/api/lifeops/scheduled-tasks/t1/escalate',['POST','POST flipped body']],
 ['/api/lifeops/scheduled-tasks/t1/acknowledge',['POST','POST flipped body']],
 ['/api/lifeops/scheduled-tasks/t1/edit',['POST','POST flipped body']],
 ['/api/lifeops/scheduled-tasks/t1/reopen',['POST','POST flipped body']],
 ['/api/lifeops/scheduled-tasks/t1/fire',['POST','POST flipped body']],
 ['/api/lifeops/occurrences/o1/snooze',['POST','POST flipped body']],
 ['/api/lifeops/definitions',['POST','POST flipped body']],
 ['/api/lifeops/definitions/d1',['PUT','PUT flipped body']],
 ['/api/triggers',['POST','POST flipped body']],
 ['/api/triggers/tr1',['GET','PUT','PUT flipped body','DELETE']],
 ['/api/triggers/tr1/runs',['GET']],
 ['/api/triggers/tr1/execute',['POST','POST flipped body']],
 ['/api/triggers/a.b',['GET','PUT','PUT flipped body','DELETE']],
 ['/api/triggers/a:b',['GET','PUT','PUT flipped body','DELETE']],
 ['/api/triggers/'+'x'.repeat(200),['GET','PUT','PUT flipped body','DELETE']],
 ['/api/approvals?state=all&limit=500',['GET']],
 ['/api/conversations',['GET','GET no owner','GET empty owner','GET blank owner','POST','POST flipped body','POST no owner','POST empty owner','POST blank owner']],
 ['/api/conversations/c1/messages?before=1',['GET','GET no owner','GET empty owner','GET blank owner']],
 ['/api/conversations/c1/messages/truncate',['POST','POST flipped body']],
 ['/api/status',['GET','GET no owner','GET empty owner','GET blank owner','POST','POST flipped body','POST no owner','POST empty owner','POST blank owner']],
 ['/api/auth/me',['GET','GET no owner','GET empty owner','GET blank owner','POST','POST flipped body','POST no owner','POST empty owner','POST blank owner']],
]);
// Where the old renderer policies refused what the native gate admitted, the table refuses: Unicode whitespace in
// a query value, and a malformed escape the native gate missed past a U+0085. The renderer also admitted empty query
// pairs ('?&', '?side=a&&mode=b', '?side=a&'), which the native gate refused and still refuses.
const settledDrift=[
 ['GET','/api/lifeops/calendar/feed?side=\u00a0'],
 ['GET','/api/lifeops/calendar/feed?side=\u2028'],
 ['GET','/api/lifeops/calendar/feed?side=%zz\u0085'],
 ['GET','/api/lifeops/calendar/feed?side=\u3000'],
 ['GET','/api/lifeops/calendar/feed?side=\ufeff'],
];
// The Cloud transport polices only the automations group: what it admitted before, by path. The old native claim
// regex stopped at a line terminator, which a parsed Cloud URL cannot carry; the table claims those as the renderer did.
const cloudAdmittedBefore=new Map([
 ['/api/automations',['GET']],
 ['/api/lifeops/reminders',['GET']],
 ['/api/lifeops/scheduled-tasks?ownerVisibleOnly=1',['GET']],
 ['/api/lifeops/scheduled-tasks/t1',['GET']],
 ['/api/lifeops/scheduled-tasks/t1/snooze',['POST']],
 ['/api/lifeops/scheduled-tasks/t1/skip',['POST']],
 ['/api/lifeops/scheduled-tasks/t1/complete',['POST']],
 ['/api/lifeops/scheduled-tasks/t1/dismiss',['POST']],
 ['/api/lifeops/scheduled-tasks/t1/escalate',['POST']],
 ['/api/lifeops/scheduled-tasks/t1/acknowledge',['POST']],
 ['/api/lifeops/scheduled-tasks/t1/edit',['POST']],
 ['/api/lifeops/scheduled-tasks/t1/reopen',['POST']],
 ['/api/lifeops/scheduled-tasks/t1/fire',['POST']],
 ['/api/lifeops/occurrences/o1/snooze',['POST']],
 ['/api/lifeops/definitions',['POST']],
 ['/api/lifeops/definitions/d1',['PUT']],
 ['/api/triggers',['POST']],
 ['/api/triggers/tr1',['GET','PUT','DELETE']],
 ['/api/triggers/tr1/runs',['GET']],
 ['/api/triggers/tr1/execute',['POST']],
 ['/api/triggers/a.b',['GET','PUT','DELETE']],
 ['/api/triggers/a:b',['GET','PUT','DELETE']],
 ['/api/triggers/'+'x'.repeat(200),['GET','PUT','DELETE']],
]);

/** Runs the real request gate, compiled from AlphaLocalAgentPlugin.request() with OwnerRoutes.java, over the cases with
 * the owner-routes.json in config: per case its verdict and, when the table loads, the claiming group and the Cloud
 * transport's automations verdict; then whether unknown group names are refused. */
function nativeGate(config,cases){
 const plugin=readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8'),request=plugin.slice(plugin.indexOf('@PluginMethod public void request(PluginCall call) {'));
 const load=request.match(/\n  (OwnerRoutes routes;\n  try\{routes=OwnerRoutes\.shipped\(getContext\(\)\.getAssets\(\)::open\);\}catch\(IllegalStateException unavailable\)\{logRequestFailure\("other",method,0,"route-table"\);call\.reject\("Unsupported local agent request\."\);return;\}\n  String group=routes\.group\(path\);)\n/)[1]
  .replace('getContext().getAssets()::open','CONFIG').replace('call.reject("Unsupported local agent request.");return;','return true;');
 const gate=request.match(/\n  if\((.*)\)\{\n   logRequestFailure\(group==null\?\"other\":group,method,0,\"gate\"\);\n   call\.reject\("Unsupported local agent request\."\);return;/)[1];
 const directory=mkdtempSync(join(tmpdir(),'alpha-owner-routes-')),harness=join(directory,'OwnerRouteHarness.java');
 try{
  writeFileSync(harness,`package ai.elizaresearch.alphaphone;
public final class OwnerRouteHarness{
 static String config;
 static final OwnerRoutes.Assets CONFIG=name->new java.io.FileInputStream(config+name);
 static void logRequestFailure(String category,String method,int status,String reason){}
 static String text(String v){return "-".equals(v)?null:new String(java.util.Base64.getDecoder().decode(v),java.nio.charset.StandardCharsets.UTF_8);}
 static boolean refused(String path,String method,String body,String expectedOwner){${load}return ${gate};}
 static char unknown(Runnable use){try{use.run();return 'A';}catch(IllegalArgumentException refused){return 'U';}}
 public static void main(String[] args)throws java.io.IOException{
  config=args[0];
  java.io.BufferedReader in=new java.io.BufferedReader(new java.io.InputStreamReader(System.in,java.nio.charset.StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();
  OwnerRoutes loaded=null;try{loaded=OwnerRoutes.shipped(CONFIG);}catch(IllegalStateException unavailable){}
  final OwnerRoutes routes=loaded;
  for(String line;(line=in.readLine())!=null;){
   String[] f=line.split(" ",-1);String method=text(f[0]),path=text(f[1]),body=text(f[2]),owner=text(f[3]);
   out.append(refused(path,method,body,owner)?'R':'A');
   if(routes!=null)out.append(' ').append(routes.group(path)).append(' ').append(routes.group(path,"automations")==null?'U':routes.allowed("automations",path,method)?'A':'R');
   out.append('\\n');
  }
  if(routes!=null)out.append(unknown(()->routes.group("/api/triggers","automations","nope"))).append(unknown(()->routes.allowed("nope","/api/triggers","POST"))).append('\\n');
  System.out.print(out);
 }
}`);
  const field=value=>value===null?'-':Buffer.from(value,'utf8').toString('base64');
  return runJvm([upstreamConnection('OwnerRoutePolicy.java'),nativeSource('OwnerRoutes.java'),harness],'ai.elizaresearch.alphaphone.OwnerRouteHarness',{json:true,args:[config+'/'],input:cases.map(c=>[c.method,c.path,c.body,c.owner].map(field).join(' ')).join('\n')+'\n'}).trim().split('\n').map(line=>line.split(' '));
 }finally{rmSync(directory,{recursive:true,force:true});}
}

test('the Android gate and the renderer interpret the owner route table identically and as the hand-mirrored gates did',{skip:jsonJarSkip},()=>{
 const connection=readFileSync(nativeSource('AlphaConnectionPlugin.java'),'utf8');
 assert.match(connection,/\(routes\.group\(url\.getPath\(\),"automations"\)!=null\|\|routes\.group\(route,"automations"\)!=null\)\?!routes\.allowed\("automations",route,method\):/,'the Cloud transport polices only the automations group');
 const native=nativeGate(join(root,'config'),cases);
 const label=c=>c.method+(c.label?' '+c.label:''),settled=new Set(settledDrift.map(([method,path])=>method+' '+path));
 cases.forEach((c,i)=>{
  const [gate,group,cloud]=native[i],claimant=ownerRouteGroup(c.path),cloudClaimant=ownerRouteGroup(c.path,'automations');
  const before=(admittedBefore.get(c.path)??[]).includes(label(c))&&!settled.has(label(c)+' '+c.path)?'A':'R',where=`${label(c)} ${JSON.stringify(c.path)}`;
  assert.equal(gate,before,`native gate, ${where}`);
  assert.equal(group,String(claimant??null),`claiming group, ${where}`);
  if(claimant)assert.equal(ownerRouteAllowed(claimant,c.path,c.method)&&!!c.owner?.trim()&&!((c.method==='GET'||c.method==='DELETE')&&c.body!==null)?'A':'R',gate,`renderer policy, ${where}`);
  assert.equal(cloudClaimant?ownerRouteAllowed('automations',c.path,c.method)?'A':'R':'U',cloud,`renderer Cloud policy, ${where}`);
  // The old renderer's automations claim.
  assert.equal(cloud,/^\/api\/(automations|lifeops|triggers)([/?]|$)/.test(c.path)?(cloudAdmittedBefore.get(c.path)??[]).includes(c.method)?'A':'R':'U',`Cloud transport, ${where}`);
 });
 for(const [method,path] of settledDrift)assert.ok(admittedBefore.get(path).includes(method),'every settled disagreement was admitted natively before');
 assert.deepEqual(native[cases.length],['UU'],'the Android interpreter refuses unknown group names');
 assert.throws(()=>ownerRouteGroup('/api/triggers','automations','nope'),/Unknown owner route group nope/);
 assert.throws(()=>ownerRouteAllowed('nope','/api/triggers','POST'),/Unknown owner route group nope/);
});

// Tables that cannot load: missing, empty, malformed, an invalid pattern, an {id} route in a group without an id pattern.
const shippedTable=readFileSync(join(root,'config/owner-routes.json'),'utf8'),edited=edit=>{const table=JSON.parse(shippedTable);edit(table);return JSON.stringify(table);};
const brokenTables=[
 ['empty',''],['malformed','{"unsafe":'],['missing groups','{"unsafe":"#"}'],
 ['invalid unsafe pattern',edited(table=>{table.unsafe='[';})],['invalid id pattern',edited(table=>{table.groups.automations.id='(';})],
 ['{id} route without an id pattern',edited(table=>{delete table.groups.automations.id;})],
];
test('the Android gate refuses every request, without throwing, when the owner route table cannot load',{skip:jsonJarSkip},()=>{
 const probes=[['GET','/api/notes/state',null],['GET','/api/triggers/tr1',null],['PUT','/api/triggers/tr1','{}'],['GET','/api/approvals?state=all&limit=500',null],['GET','/api/status',null],['POST','/api/conversations','{}']]
  .map(([method,path,body])=>({method,path,body,owner:'owner-identity'}));
 assert.deepEqual(nativeGate(join(root,'config'),probes).slice(0,probes.length).map(([gate])=>gate),['A','A','A','A','A','A'],'the probes pass with the shipped table');
 const directory=mkdtempSync(join(tmpdir(),'alpha-broken-owner-routes-'));
 try{
  assert.deepEqual(nativeGate(directory,probes),probes.map(()=>['R']),'missing table');
  for(const [name,table] of brokenTables){
   writeFileSync(join(directory,'owner-routes.json'),table);
   assert.deepEqual(nativeGate(directory,probes),probes.map(()=>['R']),name);
  }
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('the renderer interpreter fails to load every owner route table the Android gate cannot load',async()=>{
 const load=table=>build({entryPoints:[join(root,'apps/app/src/runtime/owner-route-policy.ts')],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',
  plugins:[{name:'owner-routes',setup(builder){builder.onLoad({filter:/config\/owner-routes\.json$/},()=>({contents:table,loader:'json'}));}}]})
  .then(({outputFiles})=>import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64')));
 assert.equal(typeof (await load(shippedTable)).ownerRouteAllowed,'function');
 for(const [name,table] of brokenTables)await assert.rejects(load(table),undefined,name);
});
