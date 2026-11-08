import {NotesController,type NotesControllerHooks} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-controller.ts';
import {createNotesClient} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-api.ts';
import type {AppRecordPort} from '../runtime/app-record-route-policy';
export type {NotesPhase} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-controller.ts';
export type CanonicalNotesViewHooks=NotesControllerHooks;
export const CANONICAL_NOTES_INVALIDATED_EVENT='alpha:canonical-notes-invalidated';
const binding=(port:AppRecordPort)=>JSON.stringify([port.sessionId,port.scope??null,port.identity.ownerId,port.identity.agentId,port.identity.sessionId,port.identity.origin]);
/** Adapt the private resident transport and authenticated events to shared Notes. */
export class CanonicalNotesController extends NotesController {
 private detach:()=>void=()=>{};
 private readonly sessionId:string;
 constructor(port:AppRecordPort,hooks:CanonicalNotesViewHooks){
  const identity=binding(port),current=()=>port.current()&&binding(port)===identity;
  const assertCurrent=(signal:AbortSignal)=>{signal.throwIfAborted();if(!current())throw new DOMException('The Notes connection changed.','AbortError');};
  super(createNotesClient({fetch:async<T>(path:string,options:RequestInit={}):Promise<T>=>{
   const signal=options.signal??new AbortController().signal;assertCurrent(signal);
   const method=options.method??'GET';
   if(method!=='GET'&&method!=='POST')throw Error('Unsupported Notes transport method.');
   if(options.body!==undefined&&typeof options.body!=='string')throw Error('Unsupported Notes request framing.');
   const body=options.body===undefined?undefined:JSON.parse(options.body);
   const value=await port.request(path,method,body,signal);assertCurrent(signal);return value as T;
  }}),current,hooks);
  this.sessionId=port.sessionId;
 }
 listen(target:EventTarget):void{
  this.detach();
  if(!this.current)throw new DOMException('The Notes connection changed.','AbortError');
  const changed=(event:Event)=>{const detail=(event as CustomEvent<{sessionId?:unknown;revision?:unknown}>).detail;if(!detail||detail.sessionId!==this.sessionId)return;this.invalidate(typeof detail.revision==='number'&&Number.isSafeInteger(detail.revision)&&detail.revision>=0?detail.revision:undefined);};
  target.addEventListener(CANONICAL_NOTES_INVALIDATED_EVENT,changed);
  this.detach=()=>target.removeEventListener(CANONICAL_NOTES_INVALIDATED_EVENT,changed);
 }
 override retire():void{this.detach();super.retire();}
}
