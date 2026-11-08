import {createInlineModal} from '../runtime/inline-modal';
import {currentSurfaceLayout} from '../runtime/canvas-geometry';
/** On a split canvas the open message, note or file sits beside its list, which stays usable. */
const split=()=>currentSurfaceLayout().split;
type Bag=Record<string,any>;
type Popup=[key:string,open:(out:Bag)=>boolean,close:(out:Bag)=>void];
/**
 * Menus and sheets drawn over a view behind a scrim. Each one owns focus while it is open:
 * the page under it leaves the tab and accessibility order, Escape and Back close it, and
 * focus returns to the control that opened it.
 */
const POPUPS:Record<string,Popup[]>={
 browser:[['menuModal',out=>!!out.menu,out=>out.closeMenu?.()],['shareModal',out=>!!out.share,out=>out.closeShare?.()]],
 photos:[['infoModal',out=>!!out.infoOpen,out=>out.closeSheet?.()],['shareModal',out=>!!out.shareOpen,out=>out.closeSheet?.()]],
 notes:[['shareModal',out=>!!out.shareSheet,out=>out.closeSheet?.()]],
 files:[['menuModal',out=>!!out.menuOpen,out=>out.closeMenu?.()],['moveModal',out=>!!out.moveSheet,out=>out.closeSheet?.()],['shareModal',out=>!!out.shareSheet,out=>out.closeSheet?.()]],
 workflows:[['stepModal',out=>!!out.b?.sheetOn,out=>out.b?.closeSheet?.()]],
 settings:[['sheetModal',out=>!!out.hasSheet,out=>out.sheet?.close?.()]],
};
function popupFocus(name:string,current:()=>Bag){
 const popups=(POPUPS[name]||[]).map(([key,open,close])=>({key,open,modal:reviewFocus(()=>close(current()))}));
 return (out:Bag)=>{const refs:Bag={};for(const popup of popups){popup.modal.render(popup.open(out));refs[popup.key]=popup.modal.ref;}return refs;};
}
/** Full-screen subviews replace their covered content in accessibility navigation. */
export function installSubviewAccessibility(views:Bag){
 for(const name of ['inbox','workflows']){
  const render=views[name].render;
  let output:Bag={};
  const contextModal=reviewFocus(()=>output.contextReview?.close());
  const attachmentModal=reviewFocus(()=>output.attachment?.close());
  const providerModal=reviewFocus(()=>output.provider?.close());
  const focus=focusHistory();
  const detailFocus=subviewFocus(focus.read),composeFocus=subviewFocus(focus.read),runFocus=subviewFocus(focus.read),builderFocus=subviewFocus(focus.read);
  const popups=popupFocus(name,()=>output);
  views[name].render=(state:Bag,api:Bag)=>{
   const out=output=render(state,api);
   if(name==='inbox'){
    contextModal.render(!!out.contextReviewOpen);attachmentModal.render(!!out.attachmentOpen);providerModal.render(!!out.providerReview);
    const review=!!(out.contextReviewOpen||out.attachmentOpen||out.providerReview);
    return {...out,captureSubviewFocus:focus.capture,contextModal:contextModal.ref,attachmentModal:attachmentModal.ref,providerModal:providerModal.ref,detailFocus,composeFocus,runFocus,builderFocus,listCovered:!!((out.detail&&!split())||out.composing||review),detailCovered:!!(out.composing||review),composeCovered:review};
   }
   return {...out,...popups(out),captureSubviewFocus:focus.capture,detailFocus,composeFocus,runFocus,builderFocus,listCovered:!!(out.detail||out.automation?.detail||out.runOpen||out.builder),detailCovered:!!(out.runOpen||out.builder),runCovered:!!out.builder};
  };
 }
 for(const [name,keys,coverage] of [
  ['calendar',['detail','form'],(out:Bag)=>({listCovered:!!(out.detail||out.form),detailCovered:!!out.form})],
  ['browser',['tabs','library'],(out:Bag)=>({listCovered:!!(out.tabsOpen||out.lib),tabsCovered:!!out.lib,pageCovered:!!out.editing})],
  ['photos',['album','viewer','edit','empty'],(out:Bag)=>({listCovered:!!(out.album||out.viewing||out.editing||out.viewEmpty),albumCovered:!!(out.viewing||out.editing||out.viewEmpty),viewerCovered:!!out.editing})],
  ['notes',['editor','voice','link','recording','trash'],(out:Bag)=>({listCovered:!!(((out.isEdit||out.isVoice||out.isLink)&&!split())||out.recording||out.trashOpen),detailCovered:!!(out.recording||out.trashFullOpen),trashCovered:!!out.trashConfirmOpen})],
  ['files',['folder','preview'],(out:Bag)=>({listCovered:!!(out.inFolder||(out.isPreview&&!split())),detailCovered:!!out.isPreview&&!split()})],
 ] as Array<[string,string[],(out:Bag)=>Bag]>){
  const render=views[name].render,focus=focusHistory(),refs=Object.fromEntries(keys.map(key=>[key+'Focus',subviewFocus(focus.read)]));
  let output:Bag={};
  const deleteModal=name==='photos'?reviewFocus(()=>output.closeSheet?.()):name==='notes'?reviewFocus(()=>output.trashCancel?.()):null;
  const popups=popupFocus(name,()=>output);
  views[name].render=(state:Bag,api:Bag)=>{
   const out=output=render(state,api);deleteModal?.render(!!(out.emptyOpen||out.trashConfirmOpen));
   return {...out,...refs,...popups(out),emptyModal:deleteModal?.ref,captureSubviewFocus:focus.capture,...coverage(out)};
  };
 }
 {
  // Settings has no layered subviews of its own, only the account sheet.
  const render=views.settings.render;
  let output:Bag={};
  const popups=popupFocus('settings',()=>output);
  views.settings.render=(state:Bag,api:Bag)=>{const out=output=render(state,api);return {...out,...popups(out)};};
 }

}

/** Enter the visible screen; return to its opener only when it still exists. */
function subviewFocus(read:()=>FocusTarget){
 let mounted:HTMLElement|null=null,previous:HTMLElement|null=null,scope:HTMLElement|null=null;
 return (element:HTMLElement|null)=>{
  if(element===mounted)return;
  const old=mounted,opener=previous,openerScope=scope;mounted=element;
  if(element){
   const target=read();previous=target.element;scope=target.scope;
   queueMicrotask(()=>{
    if(mounted!==element||!element.isConnected||element.closest('[inert]')||document.querySelector('dialog[open]'))return;
    element.querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]')?.focus({preventScroll:true});
   });
  }else{
   previous=null;scope=null;
   queueMicrotask(()=>{
    if(mounted||!opener)return;
    let target=opener;
    // A refreshed list may recreate the button. Match only one exact control
    // within the original surviving screen, never a similarly named other app.
    if(!target.isConnected&&openerScope?.isConnected){
     const matches=Array.from(openerScope.querySelectorAll<HTMLElement>('button,input,textarea,select,a[href]')).filter(candidate=>candidate.tagName===opener.tagName&&candidate.getAttribute('aria-label')===opener.getAttribute('aria-label')&&candidate.textContent===opener.textContent);
     if(matches.length===1)target=matches[0];
    }
    if(!target.isConnected||target.closest('[inert]'))return;
    if(document.activeElement===document.body||old?.contains(document.activeElement))target.focus({preventScroll:true});
   });
  }
 };
}

function reviewFocus(close:()=>void){
 let open=false,opener:HTMLElement|null=null;
 const modal=createInlineModal(close,()=>opener);
 return {...modal,render(next:boolean){
  if(next&&!open)opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
  open=next;
 }};
}

/**
 * A list-detail split that collapses covers its list (#411). When the list held focus, focus moves
 * into the open item that now fills the screen instead of being dropped to the page. `previous` is
 * the focused element from before the layout changed.
 */
export function keepFocusOnScreen(previous:Element|null){
 if(!(previous instanceof HTMLElement)||!previous.isConnected)return;
 if(document.activeElement!==previous&&document.activeElement!==document.body&&document.activeElement!==null)return;
 const covered=previous.closest<HTMLElement>('[data-alpha-subview][inert]');
 if(!covered)return;
 const open=Array.from(covered.parentElement?.children||[]).filter((element):element is HTMLElement=>element instanceof HTMLElement&&element.matches('[data-alpha-subview]:not([inert])')).pop();
 open?.querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]')?.focus({preventScroll:true});
}

type FocusTarget={element:HTMLElement|null;scope:HTMLElement|null};
/** Keep the opener before an asynchronous read can replace its list item. */
function focusHistory(){
 let remembered:FocusTarget={element:null,scope:null};
 const current=():FocusTarget=>{
  const element=document.activeElement instanceof HTMLElement?document.activeElement:null;
  return {element,scope:element?.closest<HTMLElement>('[data-alpha-subview]')||null};
 };
 return {
  capture:()=>{const target=current();if(target.scope)remembered=target;},
  read:()=>{const target=current();return target.scope?target:remembered.scope?.isConnected?remembered:target;},
 };
}

/**
 * Assistant replies for screen readers.
 *
 * The transcript is a plain scrolling list and focus deliberately stays on the composer after Send,
 * so a TalkBack user heard nothing when Alpha began replying, replied or failed. One visually
 * hidden polite status region, outside the conversation layer (which is inert while the chat is
 * closed), says "Alpha is replying" when a turn starts and then the settled reply once, never each
 * streamed token. The region is mounted empty before any text, because a live region that
 * arrives together with its text is not announced reliably. A voice conversation speaks its own
 * replies, so nothing is written while one is active. Focus never moves.
 */
type Shell = any;
const REPLYING = 'Alpha is replying';
const LIMIT = 600;

let region: HTMLElement | null = null, frame = 0;
function say(text: string) {
  if (!region || !region.isConnected) {
    region = document.createElement('div');
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    region.setAttribute('data-alpha-reply-announcer', '');
    region.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap';
    document.body.append(region);
  }
  // Cleared now and written on the next frame, so the same words said twice are announced twice.
  region.textContent = '';
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => { frame = 0; if (region) region.textContent = text; });
}
const bounded = (text: string) => text.length > LIMIT ? text.slice(0, LIMIT - 1).trimEnd() + '…' : text;
const agentTail = (msgs: Shell[]) => { const last = msgs.at(-1); return last?.from === 'agent' ? last : undefined; };

export function installReplyAnnouncer(Component: any) {
  const originalMount = Component.prototype.componentDidMount;
  Component.prototype.componentDidMount = function (...args: any[]) {
    originalMount?.apply(this, args);
    if (!region) say('');
  };
  const originalUpdate = Component.prototype.componentDidUpdate;
  Component.prototype.componentDidUpdate = function (...args: any[]) {
    originalUpdate?.apply(this, args);
    const previous: Shell = args[1] || {}, state: Shell = this.S();
    if (this.voiceConversationActive?.()) return;
    const before: Shell[] = previous.msgs || [], after: Shell[] = state.msgs || [];
    const was = agentTail(before), last = agentTail(after);
    const started = (!!state.turnStatus && !previous.turnStatus) || (!!state.typing && !previous.typing) || (!!last?.streaming && !was?.streaming);
    if (started && !this.replyAnnounced) { this.replyAnnounced = true; say(REPLYING); }
    if (!last || last.streaming || last.id === this.replyAnnouncedId) { if (!state.typing && !state.turnStatus && !last?.streaming) this.replyAnnounced = false; return; }
    // A streamed reply settling (its id may change on settlement), or one new agent row: a reply
    // delivered whole or a failed-turn notice. A history load replaces many rows and is not read.
    const known = new Set(before.map(message => message.id)), added = after.filter(message => !known.has(message.id));
    const settled = !!was?.streaming && !after.some(message => message.streaming);
    const arrived = before.length > 0 && added.length === 1 && added[0] === last;
    if (!settled && !arrived) { if (!state.typing && !state.turnStatus) this.replyAnnounced = false; return; }
    const text = String(last.text || last.card?.title || '').trim();
    this.replyAnnouncedId = last.id; this.replyAnnounced = false;
    if (text) say(bounded(text));
  };
}
