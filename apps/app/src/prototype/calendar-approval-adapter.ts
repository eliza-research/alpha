import {connectionController} from '../runtime/connection-ui';
import {alphaClient} from '../runtime/alpha-client';
import {calendarReviewText,calendarApprovalCommand,calendarApprovalStatus} from '../runtime/calendar-approval';
import {reviewCalendarApproval} from './calendar-approval-review';
type Shell=Record<string,any>;
/** Presentation only: stored messages, model context and copied source text remain unchanged. */
export function installCalendarApprovalAdapter(Component:Shell){
 const p=Component.prototype,render=p.renderVals,unmount=p.componentWillUnmount;
 const states=new WeakMap<object,{abort?:AbortController;statuses:Map<string,string>}>();
 const state=(shell:Shell)=>{let value=states.get(shell);if(!value){value={statuses:new Map()};states.set(shell,value);}return value;};
 const binding=()=>{const snapshot=connectionController.getSnapshot();return JSON.stringify([snapshot.session,snapshot.history?.conversationId]);};
 async function review(shell:Shell,id:string){
  const value=state(shell),snapshot=connectionController.getSnapshot();
  if(value.abort||!shell.live||document.hidden||snapshot.open||snapshot.busy||shell.S().typing)return;
  if(String(shell.S().draft||'').trim()){shell.toast('Keep or send your chat draft before reviewing this request.');return;}
  const observed=alphaClient.getState().context;if(observed.sensitive){shell.toast('Close private content before reviewing this request.');return;}
  const key=binding(),context=JSON.stringify(observed),controller=value.abort=new AbortController();
  const current=()=>{controller.signal.throwIfAborted();const now=connectionController.getSnapshot();if(!shell.live||document.hidden||binding()!==key||now.open||now.busy||JSON.stringify(alphaClient.getState().context)!==context||String(shell.S().draft||'').trim())throw Error('The agent, conversation or draft changed. Review the request again.');};
  try{
   const result=await reviewCalendarApproval(signal=>connectionController.readCalendarApproval(id,signal),controller.signal,current,row=>{value.statuses.set(key+id,calendarApprovalStatus(row));if(shell.live)shell.setState({});});
   if(!result)return;current();await shell.send(calendarApprovalCommand(result.request,result.decision));value.statuses.set(key+id,'Check the agent reply for the result.');if(shell.live)shell.setState({});
  }catch(error){if(shell.live&&!controller.signal.aborted)shell.toast(error instanceof Error?error.message:'Calendar review is unavailable.');}
  finally{if(value.abort===controller)value.abort=undefined;controller.abort();}
 }
 p.renderVals=function(){
  const out=render.call(this),value=state(this),key=binding();
  out.msgs=(out.msgs||[]).map((message:Shell)=>{
   if(!message.isAgent)return message;
   const source=String(message.text||'');
   // A verified device receipt may already replace the original review prose.
   // Keep that projection and never interpret its summary as Calendar commands.
   if(typeof message.displayText==='string'&&message.displayText!==source)return {...message,messageActionsLabel:message.messageActionsLabel?'Message actions: '+message.displayText:message.messageActionsLabel};
   const parsed=calendarReviewText(source);
   return {...message,displayText:parsed.displayText,hasCalendarText:message.hasCalendarText!==false&&!!parsed.displayText,messageActionsLabel:message.messageActionsLabel?'Message actions: '+(parsed.displayText||'Calendar request'):message.messageActionsLabel,calendarReviews:parsed.ids.map(id=>({id,status:value.statuses.get(key+id)||'Check current status',open:()=>void review(this,id)}))};
  });return out;
 };
 p.componentWillUnmount=function(){states.get(this)?.abort?.abort();states.delete(this);return unmount?.call(this);};
}
