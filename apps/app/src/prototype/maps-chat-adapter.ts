import {connectionController} from '../runtime/connection-ui';
import {mapsChatText} from '../runtime/maps-chat-markup';
type Shell=Record<string,any>;
/** Presentation only: stored messages, model context and copied source text remain unchanged.
 * A share answer is an ordinary chat message; the agent still owns the confirmation gate. */
export function installMapsChatAdapter(Component:Shell){
 const p=Component.prototype,render=p.renderVals;
 const answered=new WeakMap<object,Set<string>>();
 const answers=(shell:Shell)=>{let value=answered.get(shell);if(!value){value=new Set();answered.set(shell,value);}return value;};
 async function answer(shell:Shell,id:string,value:string){
  const snapshot=connectionController.getSnapshot(),done=answers(shell);
  if(done.has(id)||!shell.live||snapshot.open||snapshot.busy||shell.S().typing)return;
  if(String(shell.S().draft||'').trim()){shell.toast('Keep or send your chat draft before answering.');return;}
  done.add(id);if(shell.live)shell.setState({});
  try{await shell.send(value);}catch(error){done.delete(id);if(shell.live){shell.setState({});shell.toast(error instanceof Error?error.message:'The answer was not sent.');}}
 }
 p.renderVals=function(){
  const out=render.call(this),msgs=out.msgs||[],done=answers(this);
  out.msgs=msgs.map((message:Shell,index:number)=>{
   if(!message.isAgent)return message;
   // Runs after the Calendar approval adapter, so it reads that projection's displayText.
   const source=String(message.displayText??message.text??''),parsed=mapsChatText(source);
   if(!parsed.cards.length&&!parsed.choice&&parsed.displayText===source)return message;
   // Only the newest reply can still be answered; an old question is history.
   const choice=parsed.choice,id=choice?String(message.id)+':'+choice.id:'',open=!!choice&&index===msgs.length-1&&!done.has(id);
   return {...message,displayText:parsed.displayText,hasCalendarText:message.hasCalendarText!==false&&!!parsed.displayText,
    messageActionsLabel:message.messageActionsLabel?'Message actions: '+(parsed.displayText||parsed.cards[0]?.title||'Maps'):message.messageActionsLabel,
    mapsCards:parsed.cards.map(card=>({...card,lines:card.lines.map(text=>({text})),hasAttribution:!!card.attribution})),
    hasMapsChoice:open,mapsChoices:open?choice!.options.map(option=>({label:option.label,choose:()=>void answer(this,id,option.value)})):[]};
  });return out;
 };
}
