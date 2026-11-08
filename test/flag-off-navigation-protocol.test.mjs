import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync(new URL('./browser/helpers/native-navigation-protocol.ts',import.meta.url),'utf8');
const code=stripTypeScriptTypes(source,{mode:'transform'}).replace(/^export /gm,'');
function fixture(){const f={unexpected:[]},window={};new Function('window',code+';installNativeNavigationFixture();')(window);const protocol=window.createNativeNavigationFixture('owner','agent',f);return{f,request:async(method,path,body,headers,owner)=>{if(path==='/api/client-devices/register'){protocol.register(headers);return{status:200,data:{}};}const result=protocol.request(method,path,body,headers,owner);if(result)return result;f.unexpected.push(method+' '+path);return{status:404,data:{}};}};}
const prepare={clientId:'renderer',delivery:'completed-action',prepareOnly:true,viewType:'gui',completedActionHandoffId:'manual-1'};
test('actual flag-off fixture requires owner-bound preparation, claim and exact acknowledgment',async()=>{
 const {f,request}=fixture();const post=(path,body)=>request('POST',path,body,{},'owner');
 for(const view of ['chat','calendar','automations','inbox']){
  const prepared=await post(`/api/views/${view}/navigate`,{...prepare,completedActionHandoffId:'manual-'+view});assert.equal(prepared.status,200);
  const binding=prepared.data.navigationBinding;const claim=await post('/api/views/interact-claim',binding);assert.equal(typeof claim.data.claimId,'string');
  assert.equal((await post('/api/views/interact-result',{...binding,claimId:claim.data.claimId,success:true,result:{switched:true}})).data.accepted,true);
 }
 assert.deepEqual(f.unexpected,[]);
});
test('malformed preparations remain unexpected, including IDs and paths with line terminators',async()=>{
 const {f,request}=fixture();const cases=[{body:{...prepare,prepareOnly:'true'}},{body:{...prepare,payload:{}}},{owner:'foreign'},{method:'GET'},{path:'/api/views/unknown/navigate'},
 ...['\n','\r','\u2028','\u2029'].flatMap(end=>[{path:'/api/views/chat/navigate'+end},{body:{...prepare,clientId:'renderer'+end}},{body:{...prepare,completedActionHandoffId:'manual-1'+end}}])];
 for(const row of cases){const result=await request(row.method??'POST',row.path??'/api/views/chat/navigate',row.body??prepare,{},row.owner??'owner');assert.notEqual(result.status,200);}
 assert.equal(f.unexpected.length,cases.length);
});
test('unclaimed, forged or replayed acknowledgment stays unexpected',async()=>{
 const {f,request}=fixture();const post=(path,body)=>request('POST',path,body,{},'owner');const prepared=await post('/api/views/chat/navigate',prepare);const binding=prepared.data.navigationBinding;
 const ack={...binding,claimId:'forged',success:true,result:{switched:true}};assert.equal((await post('/api/views/interact-result',ack)).status,409);
 assert.equal((await post('/api/views/interact-claim',{...binding,clientId:'foreign'})).status,409);
 const claim=await post('/api/views/interact-claim',binding);const valid={...ack,claimId:claim.data.claimId};assert.equal((await post('/api/views/interact-result',valid)).status,200);
 assert.equal((await post('/api/views/interact-result',valid)).status,409);assert.equal(f.unexpected.length,3);
});
test('post-enrollment context reflects only the registered owner and device',async()=>{
 const {f,request}=fixture(),headers={'X-Eliza-Device-Id':'installation','X-Eliza-Device-Key':'key'};
 await request('POST','/api/client-devices/register',{},headers,'owner');
 const value=await request('GET','/api/client-devices/context',{},headers,'owner');assert.deepEqual(value.data,{subjectUserId:'owner',agentId:'agent',installationId:'installation',enrollmentId:'fixture-enrollment'});
 assert.equal((await request('GET','/api/client-devices/context',{},headers,'foreign')).status,404);
 assert.equal((await request('GET','/api/client-devices/context',{}, {...headers,'X-Eliza-Device-Key':'wrong'},'owner')).status,404);assert.equal(f.unexpected.length,2);
});
