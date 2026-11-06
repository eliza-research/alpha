import type {BrowserDomainDocument} from '../browser/domain-document';
import type {AssistantDraft} from '../runtime/assistant-draft-record';
type Store={recovery?:Pick<BrowserDomainDocument,'capture'|'reset'>;read():Promise<AssistantDraft|null>;save(expected:AssistantDraft|null,text:string):Promise<AssistantDraft>};
type Binding={key:string;store?:Store;record:AssistantDraft|null;last:string;ready:boolean;failed:boolean;queue:Promise<void>};
/** A send in flight: the durable draft keeps the text until dispatch is known to have succeeded. */
type Held={binding?:Binding;text:string;peer?:Binding};
/** Product composer lifecycle. Queued writes keep their original conversation binding. */
export class AssistantDraftController {
 private active?:Binding;
 private opening?:Promise<void>;
 private held?:Held;
 state={message:'',opening:true,conflict:false,savedText:'',consuming:false,error:false};
 constructor(private factory:(key:string)=>Promise<Store>,private text:()=>string,private restore:(text:string,expectedText?:string,current?:()=>boolean)=>void|Promise<void>,private changed:()=>void){}
 private publish(patch:Partial<typeof this.state>){this.state={...this.state,...patch};this.changed();}
 recovery(){return this.active?.store?.recovery;}
 retire(notify=true){this.active=undefined;this.state={message:'',opening:true,conflict:false,savedText:'',consuming:false,error:false};if(notify)this.changed();}
 unavailable(){this.retire();this.publish({opening:false,conflict:false,consuming:false,error:true,message:'Local draft could not be opened. Your current text is retained.'});}
 async open(key:string){
  if(this.active?.key===key)return this.opening;
  const opening=this.load(key);this.opening=opening;return opening;
 }
 private async load(key:string){
  const initial=this.text(),b:Binding={key,record:null,last:initial,ready:false,failed:false,queue:Promise.resolve()};this.active=b;
  this.publish({opening:true,conflict:false,consuming:false,error:false,message:''});
  try{
   // Opening is read-only. Retry a transient storage-open failure without flashing
   // an error or ever replaying a write; a retired conversation cannot restore text.
   for(let attempt=0;;attempt++){
    try{b.store=await this.factory(key);b.record=await b.store.read();break;}
    catch(error){if(this.active!==b)return;if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,attempt===0?150:600));if(this.active!==b)return;}
   }
   if(this.active!==b)return;
   if(this.text()!==initial||initial!==''){
    b.ready=true;
    if(b.record&&b.record.text!==this.text()){b.failed=true;this.publish({opening:false,conflict:true,savedText:b.record.text,message:'A saved draft is available. Review both copies.'});return;}
    b.last=b.record?.text??'';this.publish({opening:false,message:''});this.edit(this.text());
   }else{
    // The in-flight message's text stays saved until dispatch settles; never offer it again meanwhile.
    const sending=this.held?.binding?.key===key&&b.record?.text===this.held.text;
    const restored=sending?'':b.record?.text??'';b.last=restored;if(sending)this.held!.peer=b;
    // The UI may queue its state update. Keep writes paused until that commit;
    // check the original visible text and binding again inside the UI updater.
    await this.restore(restored,initial,()=>this.active===b);
    if(this.active!==b)return;
    b.ready=true;
    const current=this.text();
    if(current!==restored){
     if(!sending&&b.record&&b.record.text!==current){b.failed=true;this.publish({opening:false,conflict:true,savedText:b.record.text,message:'A saved draft is available. Review both copies.'});return;}
     b.last=restored;this.publish({opening:false,message:''});this.edit(current);
    }else this.publish({opening:false,message:''});
   }
  }catch{if(this.active===b){b.failed=true;this.publish({opening:false,conflict:false,error:true,message:'Local draft could not be read. Your current text is retained.'});}}
 }
 edit(text:string){
  const b=this.active;if(!b||text===b.last)return;b.last=text;
  if(!b.ready||b.failed||this.state.consuming||this.held?.binding===b)return;
  this.publish({message:''});
  b.queue=b.queue.then(async()=>{
   if(b.failed)return;
   try{b.record=await b.store!.save(b.record,text);if(this.active===b&&b.last===text)this.publish({message:''});}
   catch{b.failed=true;if(this.active===b)await this.reviewConflict(b);}
  });
 }
 private async reviewConflict(b:Binding){
  try{const latest=await b.store!.read();if(this.active!==b)return;b.record=latest;this.publish({opening:false,conflict:true,error:false,savedText:latest?.text??'',message:'Draft was not saved. Review the saved copy before replacing it.'});}
  catch{if(this.active===b)this.publish({opening:false,conflict:false,error:true,message:'Draft was not saved. Your current text is retained.'});}
 }
 restoreSaved(){const b=this.active;if(!b?.ready||!this.state.conflict)return;b.failed=false;b.last=b.record?.text??'';this.restore(b.last);this.publish({conflict:false,message:''});}
 keepCurrent(){const b=this.active;if(!b?.ready||!this.state.conflict)return;b.failed=false;const text=this.text();b.last=b.record?.text??'';this.publish({conflict:false,error:false,message:''});this.edit(text);}
 async retry(){const key=this.active?.key;if(!key)return;this.retire();await this.open(key);}
 /** Before dispatch: keep the saved draft durable while the composer is cleared for the in-flight
  * message. Follow with commit() or release(). Draft storage trouble never blocks a send: the text
  * is then held only in memory. Returns false, without holding, when the person edited the composer
  * or `current` reports the send is stale; their text stays where it is. */
 async hold(expectedText:string,current:()=>boolean=()=>true){
  if(this.held)throw Error('A message is already being sent.');
  const b=this.active,durable=!!b?.ready&&!b.failed&&!this.state.consuming;
  if(durable){this.edit(this.text());await b!.queue;}
  if(!current()||this.text().trim()!==expectedText)return false;
  this.held={binding:durable&&!b!.failed?b:undefined,text:this.text()};
  return true;
 }
 get holding(){return !!this.held;}
 /** Dispatch did not happen: put the text back. Newer typing is kept after the restored text. */
 release(){
  const held=this.held;if(!held)return;this.held=undefined;
  const b=held.binding&&this.active===held.binding?held.binding:this.active&&this.active===held.peer?held.peer:undefined;
  if(!b){
   // The connection changed before dispatch. The text stays saved with its own conversation;
   // an empty composer gets it back so the person's unsent words are never only in storage.
   // Text held only in memory always comes back, ahead of any newer typing.
   const now=this.text();if(now.trim()&&held.binding)return;
   const restored=now.trim()?held.text+'\n'+now:held.text;
   this.restore(restored);if(!held.binding)this.edit(restored);this.publish({message:'Not sent. Your message is back in the composer.'});return;
  }
  const now=this.text(),restored=now.trim()?held.text+'\n'+now:held.text;
  b.last=held.text;// The saved copy was never cleared.
  this.restore(restored);if(!b.failed)this.edit(restored);
  this.publish({message:'Not sent. Your message is back in the composer.'});
 }
 /** Dispatch was accepted (or may have been): clear the durable copy of the sent text only. */
 async commit(){
  const held=this.held;if(!held)return;this.held=undefined;
  const b=held.binding;
  if(!b?.ready||b.failed)return;
  // Serialized with this binding's draft writes: typing that resumes as the reply arrives is
  // queued after this clear instead of racing it with the same expected record.
  const task=b.queue.then(async()=>{
   if(b.failed)return;
   const current=this.active===b,remaining=current?this.text():'';
   try{
    b.record=await b.store!.save(b.record,remaining);if(current){b.last=remaining;if(remaining)this.publish({message:''});}
    // A reopened binding for the same conversation shares this receipt.
    const peer=held.peer;if(peer&&this.active===peer&&!peer.failed){peer.record=b.record;}
   }
   catch{b.failed=true;if(this.active===b){this.publish({opening:false,conflict:false,error:true,message:'Message sent, but its saved draft could not be cleared. Review it before sending again.'});}}
  });
  b.queue=task;await task;
 }
 async consume(expectedText:string,current:()=>boolean=()=>true){
  const b=this.active;if(!b?.ready||b.failed||this.state.consuming)throw Error('Review local draft storage before sending.');
  this.edit(this.text());await b.queue;
  if(this.active!==b||b.failed||!current()||this.text().trim()!==expectedText)throw Error('The draft changed. Review it before sending.');
  const original=b.record?.text??this.text();
  this.publish({consuming:true,message:''});
  try{
   b.record=await b.store!.save(b.record,'');
   if(this.active!==b||!current()||this.text().trim()!==expectedText){
    // Undo only our own known clear. A newer edit wins if this receipt is stale.
    try{b.record=await b.store!.save(b.record,this.active===b?this.text():original);}catch{}
    throw Error('The draft changed. Nothing was sent.');
   }
   b.last='';this.restore('');this.publish({consuming:false,message:''});
  }catch(error){if(this.active===b){b.failed=true;this.publish({consuming:false});await this.reviewConflict(b);}throw error;}
 }
}
