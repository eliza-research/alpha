import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
// Actual broker + exact shared codec, with only external error-class identities
// replaced. No real host/SDK graph, provider, native bridge, or socket is loaded.
const strip=source=>stripTypeScriptTypes(source.replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'transform'});
const brokerSource=readFileSync('backend/managed-google-agent-broker.ts','utf8');
const contractImport=brokerSource.match(/^import \{calendarReadBrokerDiagnosticHeader\} from '([^']+)';$/m);
assert.equal(contractImport?.[1],'../vendor/eliza/packages/contracts/src/calendar.ts','broker must consume the actual pinned shared source');
const contract=readFileSync(new URL(contractImport[1],new URL('../backend/managed-google-agent-broker.ts',import.meta.url)),'utf8');
const start=contract.indexOf('const calendarReadBrokerStages =');
const object=contract.indexOf('export const calendarReadBrokerDiagnosticHeader =',start);
const end=contract.indexOf('\n});',object);
assert(start>=0&&object>start&&end>object,'exact shared codec source must be present');
const codec=new Function(strip(contract.slice(start,end+5))+';return calendarReadBrokerDiagnosticHeader;')();
const helper=new Function(strip(readFileSync('backend/managed-google-failure-stage.ts','utf8'))+';return {managedGoogleFailureStage,managedGoogleTransportCodes,recordManagedGoogleFailure};')();
class CloudProtocolError extends Error{constructor(code,status,data){super('private synthetic error');this.code=code;this.status=status;this.data=data;}}
class CalendarAgentWriteRefused extends Error{constructor(){super('private refusal');this.refusal={code:'SYNTHETIC_UNCHANGED_REFUSAL'};}}
const brokerCode=strip(brokerSource);
const makeBroker=new Function('calendarReadBrokerDiagnosticHeader','managedGoogleFailureStage','managedGoogleTransportCodes','CloudProtocolError','CalendarAgentWriteRefused',brokerCode+';return createManagedGoogleAgentBroker;')(codec,helper.managedGoogleFailureStage,helper.managedGoogleTransportCodes,CloudProtocolError,CalendarAgentWriteRefused);
const secret='NEVER_EXPOSE_TOKEN_ACCOUNT_BODY_QUERY';
const generic='Google request could not be verified. Check the current account, permissions, and any saved operation receipt before retrying.';
async function call({input={calendar:{operation:'sources'}},error=new Error(secret),stage,authorized=true,method='POST',origin,success=false,logThrows=false}={}){
 if(stage)helper.recordManagedGoogleFailure(error,stage);
 const calls=[],logs=[],response=new EventEmitter();
 const host=new Proxy({}, {get(_target,name){return async()=>{calls.push(String(name));if(!success)throw error;return [];};}});
 const broker=makeBroker({host,authorized:async()=>authorized,diagnostic:value=>{logs.push(value);if(logThrows)throw Error(secret);}});
 const request=Readable.from([Buffer.from(JSON.stringify(input))]);
 Object.assign(request,{method,url:'/__alpha-owner-gmail',headers:{host:'127.0.0.1:12345',authorization:'Bearer synthetic',...(origin?{origin}: {})}});
 Object.assign(response,{writableEnded:false,destroyed:false,status:0,headers:{},body:'',writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;this.writableEnded=true;}});
 await broker(request,response);
 return {status:response.status,headers:response.headers,body:JSON.parse(response.body),calls,logs};
}
function header(result){return result.headers[codec.name];}
function noHeader(result){assert.equal(header(result),undefined);assert(!JSON.stringify(result.headers).includes(secret));}
for(const operation of ['sources','feed'])test(`authenticated Calendar ${operation} refusal carries only the shared closed diagnostic`,async()=>{
 const input={calendar:operation==='sources'?{operation}:{operation,grantId:'alpha-google:'+'a'.repeat(64),calendarId:'primary',timeMin:'2026-10-31T12:00:00-07:00',timeMax:'2026-10-31T17:00:00-07:00',timeZone:'America/Los_Angeles'}};
 const r=await call({input,error:new CloudProtocolError('http',401,{token:secret}),stage:'identity'});
 assert.equal(r.status,409);assert.deepEqual(r.body,{error:generic});
 const decoded=codec.decode(header(r),operation);assert.deepEqual(decoded,{version:1,operation,stage:'identity',code:'http',status:401,errorClass:'CloudProtocolError',capabilities:{abortAny:true,abortTimeout:true,fetch:true}});
 assert(Buffer.byteLength(header(r))<=codec.maximumBytes);assert.equal(codec.decode(header(r),operation==='sources'?'feed':'sources'),undefined);
 assert(!JSON.stringify(r.headers).includes(secret));assert(!JSON.stringify(r.body).includes(secret));
});
test('logger failure preserves the encoded diagnostic, HTTP refusal and body',async()=>{
 const r=await call({error:new CloudProtocolError('http',404,{error:'Not found',token:secret}),logThrows:true});
 assert.equal(r.status,409);assert.deepEqual(r.body,{error:generic,reason:'provider-route-unavailable'});assert.equal(codec.decode(header(r),'sources').status,404);
});
test('unrecognized error fields are omitted rather than serialized',async()=>{
 const r=await call({error:Object.assign(new Error(secret),{code:secret,status:secret,data:{token:secret}})});
 const value=codec.decode(header(r),'sources');assert.equal(value.stage,null);assert.equal(value.status,null);assert.equal(value.code,'unclassified');assert(!JSON.stringify(r.headers).includes(secret));
});
test('unauthorized requests never receive a diagnostic header',async()=>{const r=await call({authorized:false});assert.equal(r.status,401);assert.deepEqual(r.calls,[]);noHeader(r);});
for(const options of [{method:'GET'},{origin:'https://untrusted.invalid'}])test(`private request admission ${JSON.stringify(options)} never receives a diagnostic header`,async()=>{const r=await call(options);assert.equal(r.status,403);assert.deepEqual(r.calls,[]);noHeader(r);});
for(const input of [{calendar:{operation:'unknown'}},{calendar:{operation:'sources',unexpected:true}},{calendar:{operation:'feed',grantId:'incomplete'}}])test(`unclassified Calendar request has no diagnostic header: ${JSON.stringify(input)}`,async()=>{const r=await call({input});assert.equal(r.status,409);assert.deepEqual(r.calls,[]);noHeader(r);});
test('successful Calendar discovery has no failure diagnostic header',async()=>{const r=await call({success:true});assert.equal(r.status,200);assert.deepEqual(r.body,{calendars:[]});noHeader(r);});
for(const input of [
 {calendar:{operation:'write-capabilities'}},
 {calendar:{operation:'write-target'}},
 {calendar:{operation:'write-execute'}},
 {calendar:{operation:'linked-sync'}},
 {messageId:'synthetic-message'},
 {},
 {mailbox:{kind:'archive',messageId:'synthetic-message',requestId:'synthetic-request'}},
 {send:{operation:'prepare',requestId:'synthetic-request',to:['synthetic@example.invalid'],subject:'Synthetic',bodyText:'Synthetic'}},
 {send:{operation:'receipt',id:'synthetic-operation'}},
 {send:{operation:'dispatch',id:'synthetic-operation',reviewDigest:'a'.repeat(64),to:['synthetic@example.invalid'],subject:'Synthetic',bodyText:'Synthetic'}},
])test(`non-read refusal preserves status/body without diagnostic header: ${JSON.stringify(input)}`,async()=>{const r=await call({input});assert.equal(r.status,409);assert.deepEqual(r.body,{error:generic});noHeader(r);});
test('typed Calendar write refusal remains its existing 200 result without header',async()=>{const r=await call({input:{calendar:{operation:'write-execute'}},error:new CalendarAgentWriteRefused()});assert.equal(r.status,200);assert.deepEqual(r.body,{calendarFailure:{code:'SYNTHETIC_UNCHANGED_REFUSAL'}});noHeader(r);});
test('shared decoder refuses noncanonical, extra-key, mismatched and oversized wire diagnostics',async()=>{
 const r=await call(),wire=header(r);assert(codec.decode(wire,'sources'));
 for(const value of [' '+wire,wire.replace('"version":1','"version":1,"extra":"'+secret+'"'),'x'.repeat(513),wire.replace('"operation":"sources"','"operation":"feed"')])assert.equal(codec.decode(value,'sources'),undefined);
});

for(const missing of ['global-constructors','static-methods'])test(`API-limited diagnostic globals remain safe: ${missing}`,async()=>{
 const globals=['DOMException','AbortSignal'],savedGlobals=globals.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]);
 const savedStatics=['any','timeout'].map(name=>[name,Object.getOwnPropertyDescriptor(AbortSignal,name)]);
 try{
  if(missing==='global-constructors'){
   Object.defineProperty(globalThis,'DOMException',{configurable:true,writable:true,value:undefined});
   Object.defineProperty(globalThis,'AbortSignal',{configurable:true,writable:true,value:undefined});
  }else for(const name of ['any','timeout'])Object.defineProperty(AbortSignal,name,{configurable:true,writable:true,value:undefined});
  const r=await call({error:new TypeError(secret),stage:'signal'});
  assert.equal(r.status,409);assert.deepEqual(r.body,{error:generic});
  const decoded=codec.decode(header(r),'sources');assert(decoded);
  assert.equal(decoded.errorClass,'TypeError');assert.equal(decoded.stage,'signal');
  assert.deepEqual(decoded.capabilities,{abortAny:false,abortTimeout:false,fetch:true});
  assert(!JSON.stringify(r.headers).includes(secret));
 }finally{
  for(const [name,descriptor] of savedGlobals)Object.defineProperty(globalThis,name,descriptor);
  for(const [name,descriptor] of savedStatics)Object.defineProperty(AbortSignal,name,descriptor);
 }
});
