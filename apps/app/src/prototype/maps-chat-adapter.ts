import {connectionController} from '../runtime/connection-ui';
import {mapsChatText} from '../runtime/maps-chat-markup';
import {mapsAgentResultsPort} from '../maps/agent-navigation';
import type {AgentMapsResult} from '../maps/device-navigation';
type Shell=Record<string,any>;
type Spec=ReturnType<typeof mapsChatText>['specs'][number];
/** A card Maps can open: a place, search results or a route. Locate and hand-off cards cannot. */
const result=(spec:Spec):AgentMapsResult|null=>spec.kind==='place'?{kind:'place',place:spec.place}:spec.kind==='places'?{kind:'places',query:spec.query,places:spec.places}:spec.kind==='route'?{kind:'route',destination:spec.destination,travelMode:spec.travelMode}:null;
/** Messages seen per shell. Only a reply appended while the conversation is open is new; a
 * restored or replaced history never opens anything. */
type Seen={ids:Set<string>;last:string|null;fresh:Set<string>};
/** Presentation only: stored messages, model context and copied source text remain unchanged.
 * A share answer is an ordinary chat message; the agent still owns the confirmation gate.
 * The newest new agent result opens Maps at it once (the phone's own Maps binding decides
 * whether it can); any older card offers Show in Maps. Nothing is sent to the agent. */
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
 const seen=new WeakMap<object,Seen>();
 /** Ids of messages appended since the previous render, kept until a later message follows them. */
 function fresh(shell:Shell,msgs:Shell[]){
  const ids=msgs.map(message=>String(message.id)),state=seen.get(shell);
  if(!state){seen.set(shell,{ids:new Set(ids),last:ids.at(-1)??null,fresh:new Set()});return new Set<string>();}
  const appended=state.last!==null&&ids.includes(state.last);
  for(const id of ids){if(!state.ids.has(id)){state.ids.add(id);if(appended)state.fresh.add(id);}}
  for(const id of state.fresh)if(id!==ids.at(-1))state.fresh.delete(id);
  state.last=ids.at(-1)??null;return state.fresh;
 }
 async function openInMaps(shell:Shell,target:AgentMapsResult,explicit:boolean){
  const maps=mapsAgentResultsPort.current;
  if(!maps){if(explicit&&shell.live)shell.toast('Maps isn’t available right now.');return;}
  // A refusal on an automatic open is quiet: the card keeps its Show in Maps button. Only a reply
  // that just arrived is the agent acting; a tap on Show in Maps never starts guidance by itself.
  try{
   const opened=await maps.open(target,{allowDirectStart:!explicit});
   // Already on screen, or guidance is on: the tap brings Maps to the front instead of doing nothing.
   if(opened===null&&explicit&&shell.live)shell.openView('maps',{keepState:true});
  }catch(error){if(explicit&&shell.live)shell.toast(error instanceof Error?error.message:'Maps couldn’t open this.');}
 }
 p.renderVals=function(){
  const out=render.call(this),msgs=out.msgs||[],done=answers(this),appended=fresh(this,msgs);
  out.msgs=msgs.map((message:Shell,index:number)=>{
   if(!message.isAgent)return message;
   const parsed=mapsChatText(String(message.displayText??message.text??''));
   if(!parsed.cards.length&&!parsed.choice)return message;
   const results=parsed.specs.map(result);
   // The newest result of a reply that just arrived opens once, outside render.
   const newest=[...results].reverse().find(Boolean);
   if(newest&&index===msgs.length-1&&appended.has(String(message.id))&&this.live&&!this.props?.assistantSurface){
    appended.delete(String(message.id));const shell=this;queueMicrotask(()=>{if(shell.live)void openInMaps(shell,newest,false);});
   }
   // Only the newest reply can still be answered; an old question is history.
   const choice=parsed.choice,id=choice?String(message.id)+':'+choice.id:'',open=!!choice&&index===msgs.length-1&&!done.has(id);
   return {...message,displayText:parsed.displayText,hasCalendarText:message.hasCalendarText!==false&&!!parsed.displayText,
    messageActionsLabel:message.messageActionsLabel?'Message actions: '+(parsed.displayText||parsed.cards[0]?.title||'Maps'):message.messageActionsLabel,
    mapsCards:parsed.cards.map((card,at)=>{const target=results[at];return {...card,lines:card.lines.map(text=>({text})),hasAttribution:!!card.attribution,
     canOpen:!!target&&!this.props?.assistantSurface,open:()=>{if(target)void openInMaps(this,target,true);}};}),
    hasMapsChoice:open,mapsChoices:open?choice!.options.map(option=>({label:option.label,choose:()=>void answer(this,id,option.value)})):[]};
  });return out;
 };
}
