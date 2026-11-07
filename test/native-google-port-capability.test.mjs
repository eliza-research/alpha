import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';

// Controlled-port tests of the ACTUAL port-selection expression and Google
// outcome method. No Capacitor bridge, browser, provider or credentials execute.
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const connection=read('apps/app/src/runtime/native-connection.ts');
const protocol=read('apps/app/src/runtime/cloud-protocol.ts');
function selection(native,declared,port){
 const from=connection.indexOf('export const cloudSignIn:CloudSignInPort|undefined=');
 const to=connection.indexOf('\n\n',from);
 assert.ok(from>=0&&to>from,'actual complete port expression');
 const js=transformSync(connection.slice(from,to).replace('export ',''),{loader:'ts'}).code;
 // Model Capacitor's actual unknown-property function synthesis, including an
 // explicitly declared native cancellation extension that is NOT a browser receipt.
 const proxy=new Proxy(port,{get(target,key){return key in target?target[key]:(()=>{throw Error('Native method not implemented');});}});
 const actual=new Function('nativeSignInHeader','browserCloudHost','registerPlugin','BrowserCloudSignIn',js+';return cloudSignIn;')(
  native,true,(_name,options)=>options?port:proxy,class {});
 return {actual};
}
function googleMethod(){
 const from=protocol.indexOf('  async signInWithGoogle(');
 const to=protocol.indexOf('  /** Sends a six-digit code',from);
 assert.ok(from>=0&&to>from,'actual Google outcome method');
 const js=transformSync('const methods={'+protocol.slice(from,to)+'};',{loader:'ts'}).code;
 class ProtocolError extends Error{constructor(code){super(code);this.code=code;}}
 return new Function('CloudProtocolError',js+';return methods.signInWithGoogle;')(ProtocolError);
}
function host(port,credential){
 const state={stored:0,cancel:0};
 const receiver={environment:'production',googleSignInCommitted:false,
  get googleCancellationSupported(){return typeof port.cancelGoogleSignIn==='function';},
  async signInStep(signal,run){signal.throwIfAborted();return run(port);},
  async storedSignIn(outcome,signal){signal.throwIfAborted();state.stored++;return outcome;},
  credentials:{async read(){return credential;}},
 };
 return {receiver,state};
}
for(const declared of [false,true])test(`native Google keeps native stored outcome (declared cancellation=${declared})`,async()=>{
 const outcome={status:'authenticated',environment:'production',expiresAt:Date.now()+60000};
 let cancellation=0;
 const port={async startGoogle(){return outcome;},async cancel(){cancellation++;},
  ...(declared?{async cancelGoogleSignIn(){throw Error('Native cancellation is not a browser commit receipt');}}:{})};
 const {actual}=selection(true,declared,port);
 assert.equal(actual.cancelGoogleSignIn,undefined);
 const {receiver,state}=host(actual,{token:'synthetic-native-token',credentialId:'native-slot'});
 assert.equal(await googleMethod().call(receiver,new AbortController().signal),outcome);
 assert.equal(state.stored,1);
 assert.equal(receiver.googleSignInCommitted,false);
 await actual.cancel();assert.equal(cancellation,1,'ordinary native cancel remains intact');
});
test('real browser extension remains visible and retains strict commit receipt guards',async()=>{
 const credential={credentialId:'browser-slot',credentialReference:'browser-reference',expiresAt:Date.now()+60000};
 const outcome={status:'authenticated',environment:'production',credentialId:'browser-slot',attemptId:'browser-attempt'};
 let cancellations=0;
 const port={async startGoogle(){return outcome;},async cancelGoogleSignIn(){cancellations++;return outcome;},async cancel(){}};
 const {actual}=selection(false,false,port);
 assert.equal(actual,port,'actual browser factory keeps its original port');
 assert.equal(await actual.cancelGoogleSignIn(),outcome);assert.equal(cancellations,1);
 const {receiver,state}=host(actual,credential);
 const result=await googleMethod().call(receiver,new AbortController().signal);
 assert.equal(state.stored,0);assert.equal(receiver.googleSignInCommitted,true);
 assert.deepEqual(result.committedCredential,{credentialId:'browser-slot',credentialReference:'browser-reference'});
 await assert.rejects(googleMethod().call(host(actual,{...credential,token:'forbidden-browser-token'}).receiver,new AbortController().signal),error=>error.code==='account-changed');
 await assert.rejects(googleMethod().call(host({...actual,startGoogle:async()=>({...outcome,attemptId:undefined})},credential).receiver,new AbortController().signal),error=>error.code==='invalid-response');
});
