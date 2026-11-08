import {findMapsCardRegions,type MapsCardPlace,type MapsCardSpec} from '../../../../.eliza/client-features/packages/ui/src/components/chat/message-maps-parser.ts';
import {guidanceDistance,guidanceDuration} from '../maps/guidance';
import {connectionController} from '../runtime/connection-ui';

/** Display-only projection of an agent Maps card. Links are shown as text, never opened. */
export type MapsChatCard={kind:MapsCardSpec['kind'];title:string;lines:string[];attribution:string};
/** The plugin-maps share gate: exactly two bounded answers that are sent back verbatim. */
export type MapsShareChoice={id:string;options:{label:string;value:string}[]};

const MODES:Record<string,string>={drive:'Driving',walk:'Walking',bicycle:'Cycling',transit:'Transit'};
const placeLine=(place:MapsCardPlace)=>place.formattedAddress?`${place.name}, ${place.formattedAddress}`:place.name;
// Alpha's agent context carries no device position, so the locate card cannot be answered here.
const LOCATE_LINE='Alpha does not send your location to the agent. Name a starting place or address instead.';

function present(card:MapsCardSpec):MapsChatCard{
 switch(card.kind){
  case 'place':return {kind:card.kind,title:card.place.name,lines:card.place.formattedAddress?[card.place.formattedAddress]:[],attribution:card.attribution||''};
  case 'places':return {kind:card.kind,title:`Places for “${card.query}”`,lines:card.places.map(placeLine),attribution:card.attribution||''};
  case 'route':return {kind:card.kind,title:`Route to ${card.destination.name}`,lines:[`From ${card.origin.name}`,`${MODES[card.travelMode]} · ${guidanceDistance(card.distanceMeters)} · ${guidanceDuration(card.durationSeconds)}`,...card.warnings],attribution:card.attribution||''};
  case 'handoff':return {kind:card.kind,title:card.handoffKind==='share'?`Location link for ${card.place.name}`:`Directions to ${card.place.name}`,lines:[...(card.place.formattedAddress?[card.place.formattedAddress]:[]),card.webUri],attribution:''};
  case 'locate':return {kind:card.kind,title:'Location needed',lines:[LOCATE_LINE],attribution:''};
 }
}

const SHARE_CHOICE=/\[CHOICE:maps-share id=(maps-share-[^\]\s]{1,200})\]\r?\n([\s\S]*?)\r?\n\[\/CHOICE\]/g;
function shareChoice(id:string,body:string):MapsShareChoice|null{
 const options=body.split(/\r?\n/).map(line=>{const at=line.lastIndexOf('=');return at>0?{value:line.slice(0,at).trim(),label:line.slice(at+1).trim()}:{value:'',label:''};});
 if(options.length!==2||options.some(o=>!o.value||!o.label||o.value.length>500||o.label.length>80))return null;
 return {id,options};
}

// Alpha has no form surface. The question the form asks is already in the prose before it
// (plugin-maps missingInput), so a complete form block is dropped and nothing is lost.
const FORM=/\[FORM\]\r?\n(\{[^\r\n]*\})\r?\n\[\/FORM\]/g;
function formBlock(json:string){
 try{const body=JSON.parse(json);return !!body&&typeof body==='object'&&typeof body.id==='string'&&Array.isArray(body.fields);}catch{return false;}
}

/** Replace valid Maps markup with presentation metadata. Malformed markup stays literal text. */
export function mapsChatText(text:string){
 const cards:MapsChatCard[]=[];let choice:MapsShareChoice|null=null,rendered=text;
 const regions=findMapsCardRegions(text);
 for(const region of [...regions].reverse()){cards.unshift(present(region.card));rendered=rendered.slice(0,region.start)+rendered.slice(region.end);}
 rendered=rendered.replace(SHARE_CHOICE,(whole,id,body)=>{
  // The question itself stays in the surrounding prose; only its answers become buttons.
  const parsed=choice?null:shareChoice(id,body);if(!parsed)return whole;choice=parsed;return '';
 });
 let forms=false;
 rendered=rendered.replace(FORM,(whole,json)=>formBlock(json)?(forms=true,''):whole);
 // Ordinary messages keep their exact text, including indentation and trailing paragraphs.
 const displayText=cards.length||choice||forms?rendered.replace(/\n{3,}/g,'\n\n').trim():rendered;
 return {displayText,cards,choice:choice as MapsShareChoice|null};
}

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
  // send() refuses a prompt while a message edit is open; do not mark the answer as sent.
  if(shell.messageEditTarget){shell.toast('Finish or cancel the message you are editing first.');return;}
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
