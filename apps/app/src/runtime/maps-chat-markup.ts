import {findMapsCardRegions,type MapsCardPlace,type MapsCardSpec} from '../../../../.eliza/client-features/packages/ui/src/components/chat/message-maps-parser.ts';
import {guidanceDistance,guidanceDuration} from '../maps/guidance';

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

/** Replace valid Maps markup with presentation metadata. Malformed markup stays literal text.
 * `specs` are the validated cards themselves, in the same order, for opening a result in Maps. */
export function mapsChatText(text:string){
 const cards:MapsChatCard[]=[],specs:MapsCardSpec[]=[];let choice:MapsShareChoice|null=null,rendered=text;
 const regions=findMapsCardRegions(text);
 for(const region of [...regions].reverse()){cards.unshift(present(region.card));specs.unshift(region.card);rendered=rendered.slice(0,region.start)+rendered.slice(region.end);}
 rendered=rendered.replace(SHARE_CHOICE,(whole,id,body)=>{
  // The question itself stays in the surrounding prose; only its answers become buttons.
  const parsed=choice?null:shareChoice(id,body);if(!parsed)return whole;choice=parsed;return '';
 });
 // Ordinary messages keep their exact text, including indentation and trailing paragraphs.
 const displayText=cards.length||choice?rendered.replace(/\n{3,}/g,'\n\n').trim():rendered;
 return {displayText,cards,specs,choice:choice as MapsShareChoice|null};
}
