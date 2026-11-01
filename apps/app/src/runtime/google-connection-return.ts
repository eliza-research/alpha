/** A foreground signal requests a canonical read; it never proves an OAuth grant. */
export type GoogleConnectionReturnBinding=Readonly<{
 client:object;environment:string;userId:string;organizationId:string;sessionId:string;credentialId:string;
}>;
export function sameGoogleConnectionReturnBinding(a:GoogleConnectionReturnBinding|null,b:GoogleConnectionReturnBinding|null):boolean {
 return !!a&&!!b&&a.client===b.client&&a.environment===b.environment&&a.userId===b.userId&&a.organizationId===b.organizationId&&a.sessionId===b.sessionId&&a.credentialId===b.credentialId;
}
type Listener={remove():Promise<void>|void};
export function watchGoogleConnectionReturn(options:{
 binding:GoogleConnectionReturnBinding;
 current:()=>GoogleConnectionReturnBinding|null;
 foreground:()=>boolean;
 refresh:()=>void;
 onVisibilityChange:(listener:()=>void)=>()=>void;
 onFocus:(listener:()=>void)=>()=>void;
 onNativeResume?:(listener:()=>void)=>Promise<Listener>;
}){
 let closed=false,pending:{backgrounded:boolean}|undefined,native:Listener|undefined;
 const current=()=>!closed&&sameGoogleConnectionReturnBinding(options.binding,options.current());
 const returned=()=>{
  if(!current()){pending=undefined;return;}
  if(!pending?.backgrounded||!options.foreground())return;
  pending=undefined; // Consume before scheduling the existing load; duplicate events are inert.
  options.refresh();
 };
 const visibility=()=>{
  if(!current()){pending=undefined;return;}
  if(!options.foreground()){if(pending)pending.backgrounded=true;}
  else returned();
 };
 const removeVisibility=options.onVisibilityChange(visibility),removeFocus=options.onFocus(returned);
 // Native appResumed is retained. Registration resolution does NOT mean its
 // cached callback drained; only an independently observed background can arm return.
 const ready=options.onNativeResume?options.onNativeResume(returned).then(handle=>{
  if(closed)void Promise.resolve(handle.remove()).catch(()=>{});else native=handle;
 },()=>{}):Promise.resolve();
 return {
  ready,
  isCurrent:current,
  arm(){
   if(!current()||!options.foreground())throw new DOMException('The Google connection changed.','AbortError');
   const attempt={backgrounded:false};pending=attempt;
   return ()=>{if(pending===attempt)pending=undefined;};
  },
  close(){
   if(closed)return;closed=true;pending=undefined;removeVisibility();removeFocus();
   if(native)void Promise.resolve(native.remove()).catch(()=>{});
  },
 };
}
