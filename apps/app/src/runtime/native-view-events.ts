/** Typed, live-only native renderer events over the existing resident IPC feed. */
export interface NativeViewEventPort {
 addListener(name:'alphaViewEvent',listener:(value:any)=>void):Promise<{remove():Promise<void>}>;
 subscribeViewEvents(input:{subscriptionId:string;ownerId:string;clientId:string}):Promise<{subscriptionId:string}>;
 unsubscribeViewEvents(input:{subscriptionId:string}):Promise<unknown>;
}
export function subscribeNativeViewEvents(port:NativeViewEventPort,ownerId:string,clientId:string,listener:(frame:unknown)=>void,ended:()=>void){
 const subscriptionId=crypto.randomUUID();let active=true,dispatched=false,remove:(()=>Promise<void>)|undefined;
 const quiet=(work:Promise<unknown>)=>{void work.catch(()=>{});};
 const close=()=>{if(!active)return;active=false;if(remove)quiet(remove());if(dispatched)quiet(port.unsubscribeViewEvents({subscriptionId}));ended();};
 const ready=(async()=>{
  const handle=await port.addListener('alphaViewEvent',value=>{
   if(!active||value?.subscriptionId!==subscriptionId)return;
   if(value.type==='end'){close();return;}
   const event=value.event;
   if(value.type==='event'&&event?.type==='agent_event'&&event.stream==='view-interact'&&event.payload?.clientId===clientId)listener(event.payload.frame);
  });remove=()=>handle.remove();if(!active){quiet(remove());throw Error('Renderer retired');}
  dispatched=true;const reply=await port.subscribeViewEvents({subscriptionId,ownerId,clientId});
  if(!active||reply.subscriptionId!==subscriptionId){close();quiet(port.unsubscribeViewEvents({subscriptionId}));throw Error('Renderer subscription changed');}
 })().catch(error=>{close();throw error;});
 return {ready,close};
}
