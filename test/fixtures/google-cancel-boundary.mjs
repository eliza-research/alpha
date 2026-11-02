import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';

// Execute only the actual browser class and the actual protocol sign-in step.
// No application imports, shared SDK, HTTP, provider, credential store or filesystem writes.
export function googleCancelBoundary(root) {
 const browser=readFileSync(new URL('apps/app/src/browser/cloud-connection.ts',root),'utf8');
 const protocol=readFileSync(new URL('apps/app/src/runtime/cloud-protocol.ts',root),'utf8');
 const from=browser.indexOf('export class BrowserCloudSignIn extends WebPlugin');
 assert.ok(from>=0,'actual browser class found');
 const stepFrom=protocol.indexOf('  private async signInStep<T>');
 const stepTo=protocol.indexOf('  /**\n   * The Cloud sign-in hand-off',stepFrom);
 assert.ok(stepFrom>=0&&stepTo>stepFrom,'actual protocol step found');
 const publicCancel=protocol.match(/  async cancelGoogleSignIn\(\): Promise<boolean> \{[^\n]+\}/)?.[0];
 assert.ok(publicCancel,'actual protocol cancellation entry found');
 const popups=[],polls=new Map(),started=[];
 let cancelReply=async()=>({ok:true,json:async()=>({status:'cancelled'})}),cancelCalls=0;
 const response=value=>({ok:true,json:async()=>value});
 const browserCloudCall=async(data,signal)=>{
  if(data.operation==='signInStartGoogle') {
   const wait=Promise.withResolvers();polls.set(data.attemptId,wait);started.push(data.attemptId);
   return response({attemptId:data.attemptId,expiresAt:Date.now()+60000,browserUrl:`https://cloud.example.invalid/auth/cli-login?session=${randomUUID()}&app=alpha&provider=google`});
  }
  if(data.operation==='signInPollGoogle') {
   const pending=polls.get(data.attemptId);assert.ok(pending);
   if(signal?.aborted)throw signal.reason;
   return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason);
    signal?.addEventListener('abort',abort,{once:true});
    pending.promise.then(value=>{signal?.removeEventListener('abort',abort);resolve(response(value));},error=>{signal?.removeEventListener('abort',abort);reject(error);});
   });
  }
  assert.equal(data.operation,'signInCancelGoogle','unexpected RPC');
  return cancelReply(data,++cancelCalls);
 };
 const sandbox={URL,Date,AbortController,DOMException,crypto:{randomUUID},setTimeout,clearTimeout,
  WebPlugin:class {},browserCloudCall,productionCloud:{web:'https://cloud.example.invalid'},stagingCloud:{web:'https://staging.example.invalid'},
  window:{open(){const popup={closed:false,close(){this.closed=true;},location:{replace(){}}};popups.push(popup);return popup;}},
  CloudProtocolError:class extends Error {},
  CloudSignInError:class extends Error {constructor(code){super(code);this.code=code;}static from(error){return error;}}
 };
 const protocolClass=`class ProtocolBoundary {activeLogin=null;activeGoogleCancellation=null;googleSignInCommitted=false;authority={};constructor(port){this.options={signIn:port};}\n${publicCancel}\n${protocol.slice(stepFrom,stepTo)}\n}`;
 vm.runInNewContext(stripTypeScriptTypes(browser.slice(from).replace('export class','class')+'\n'+protocolClass,{mode:'transform'})+';globalThis.Browser=BrowserCloudSignIn;globalThis.Protocol=ProtocolBoundary;',sandbox);
 const port=new sandbox.Browser(),client=new sandbox.Protocol(port);
 const parse=value=>{assert.equal(value.status,'authenticated');assert.equal(value.environment,'production');assert.equal(typeof value.credentialId,'string');assert.equal(typeof value.attemptId,'string');return value;};
 const outcome=id=>({status:'authenticated',environment:'production',attemptId:id,credentialId:randomUUID(),expiresAt:Date.now()+60000,accountCreated:false});
 const begin=()=>{
  let browserResult;
  const result=client.signInStep(new AbortController().signal,()=>{browserResult=port.startGoogle({environment:'production'});return browserResult;},parse,()=>{});
  // Attach a handler immediately so deliberately rejected host polls never leak an unhandled rejection.
  result.catch(()=>{});
  return {result,browserResult:()=>browserResult};
 };
 return {port,client,popups,polls,started,begin,outcome,response,setCancel(fn){cancelReply=fn;},get cancelCalls(){return cancelCalls;}};
}
export async function flush(){for(let n=0;n<12;n++)await Promise.resolve();}
