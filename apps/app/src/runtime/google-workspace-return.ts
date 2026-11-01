/** Google Workspace's existing AppReturn v2, separate from Cloud sign-in. */
export const GOOGLE_WORKSPACE_CALLBACK='https://alphacompute.ai/alphaphone/gmail/callback';
export interface GoogleWorkspaceBinding {
 environment:'production'|'staging';userId:string;organizationId:string;credentialId:string;sessionId:string;
}
export interface GoogleWorkspaceReturnPort {
 prepare(binding:GoogleWorkspaceBinding):Promise<{supported:boolean;redirectUrl?:string;state?:string}>;
 consume(binding:GoogleWorkspaceBinding):Promise<{result:'none'|'connected'|'denied'|'failed';connectionId?:string}>;
 cancel(state:string):Promise<void>;
 subscribe(listener:()=>void):Promise<{remove():void|Promise<void>}>;
}
export function googleWorkspaceRedirectAllowed(value:string):boolean {
 try {
  const url=new URL(value),keys=[...url.searchParams.keys()];
  return value===`${GOOGLE_WORKSPACE_CALLBACK}?state=${url.searchParams.get('state')}`&&keys.length===1&&keys[0]==='state'&&/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('state')??'');
 }catch{return false;}
}
export function sameGoogleWorkspaceBinding(a:GoogleWorkspaceBinding,b:GoogleWorkspaceBinding|null):boolean {
 return !!b&&a.environment===b.environment&&a.userId===b.userId&&a.organizationId===b.organizationId&&a.credentialId===b.credentialId&&a.sessionId===b.sessionId;
}
export async function prepareGoogleWorkspaceReturn(port:GoogleWorkspaceReturnPort|undefined,binding:GoogleWorkspaceBinding,current:()=>GoogleWorkspaceBinding|null){
 if(!port||binding.environment!=='production')return undefined;
 if(!sameGoogleWorkspaceBinding(binding,current()))throw new DOMException('Google connection changed','AbortError');
 const offer=await port.prepare(binding);
 if(!sameGoogleWorkspaceBinding(binding,current())){if(offer.state)await port.cancel(offer.state);throw new DOMException('Google connection changed','AbortError');}
 if(!offer.supported)return undefined;
 if(typeof offer.redirectUrl!=='string'||!googleWorkspaceRedirectAllowed(offer.redirectUrl)||typeof offer.state!=='string'||new URL(offer.redirectUrl).searchParams.get('state')!==offer.state)throw Error('Google app return unavailable');
 return {redirectUrl:offer.redirectUrl,state:offer.state};
}

export function nativeGoogleWorkspaceReturnAvailable(headers:unknown):boolean {
 if(!Array.isArray(headers))return false;
 return headers.some(header=>header&&typeof header==='object'&&header.name==='AlphaConnection'&&Array.isArray(header.methods)&&['prepareGoogleWorkspaceReturn','consumeGoogleWorkspaceReturn','cancelGoogleWorkspaceReturn'].every(name=>header.methods.some((method:unknown)=>!!method&&typeof method==='object'&&'name' in method&&method.name===name)));
}

/** Identity-ready consumer is independent of whether the connections panel is open. */
export function watchGoogleWorkspaceReturn(port:GoogleWorkspaceReturnPort,binding:GoogleWorkspaceBinding,current:()=>GoogleWorkspaceBinding|null,onReturn:(result:{result:'connected'|'denied'|'failed';connectionId?:string})=>void,onError:()=>void){
 let closed=false,busy=false,queued=false,listener:{remove():void|Promise<void>}|undefined;
 const valid=()=>!closed&&sameGoogleWorkspaceBinding(binding,current());
 const drain=async()=>{
  if(!valid())return;if(busy){queued=true;return;}busy=true;
  try{const result=await port.consume(binding);if(!valid()||result.result==='none')return;
   if(!['connected','denied','failed'].includes(result.result)||(result.result==='connected'&&!/^[A-Za-z0-9_-]{1,128}$/.test(result.connectionId??''))||(result.result!=='connected'&&result.connectionId!==undefined))throw Error('Invalid Google return');
   if(result.result==='connected'||result.result==='denied'||result.result==='failed')onReturn({result:result.result,...(result.connectionId?{connectionId:result.connectionId}:{})});
  }catch{if(valid())onError();}finally{busy=false;if(queued&&valid()){queued=false;void drain();}}
 };
 const ready=port.subscribe(()=>void drain()).then(handle=>{listener=handle;if(closed)return handle.remove();return drain();},()=>{if(valid())onError();});
 return {ready,close(){if(closed)return;closed=true;queued=false;void Promise.resolve(listener?.remove()).catch(()=>{});}};
}
