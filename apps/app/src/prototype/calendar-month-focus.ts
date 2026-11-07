import {createInlineModal} from '../runtime/inline-modal';
type Bag=Record<string,any>;
/**
 * The Calendar title menu (views and calendar switches) and the delete sheet own focus while open:
 * covered controls cannot act, Escape closes them and focus returns to the control that opened
 * them. Back closes the menu, then the sheet, before anything else (the half chat included);
 * Search is closed by the Calendar model's own Back, after the chat is lowered.
 */
export function installCalendarMonthFocus(Component:any,views:Bag){
 const render=views.calendar.render;let latest:Bag={};
 const menu=createInlineModal(()=>latest.closeMenu?.(),()=>document.querySelector<HTMLElement>('button[aria-label="Calendar views"]'));
 const sheet=createInlineModal(()=>latest.deleteSheet?.cancel?.(),()=>document.querySelector<HTMLElement>('button[aria-label="Delete event"]'));
 // Search takes focus once when it opens (a stable ref, so later renders never move focus).
 let searchInput:HTMLInputElement|null=null;
 // When Search closes and focus was lost with it, focus returns to the Search button.
 const searchRef=(element:HTMLInputElement|null)=>{
  if(element&&element!==searchInput)element.focus({preventScroll:true});
  if(!element&&searchInput)queueMicrotask(()=>{const active=document.activeElement;if(active&&active!==document.body&&active.isConnected)return;const button=document.querySelector<HTMLElement>('button[aria-label="Search"]');if(button?.isConnected&&!button.closest('[inert]'))button.focus({preventScroll:true});});
  searchInput=element;
 };
 views.calendar.render=(state:Bag,api:Bag)=>{const out=render(state,api);latest=out;return {...out,menuModalRef:menu.ref,sheetModalRef:sheet.ref,searchRef};};
 const live=(selector:string)=>{const element=document.querySelector<HTMLElement>(selector);return !!element?.isConnected&&!element.closest('[inert]');};
 const p=Component.prototype,mount=p.componentDidMount,unmount=p.componentWillUnmount;
 const back=(event:Event)=>{
  const close=latest.menuOpen&&live('[data-alpha-calendar-menu]')?latest.closeMenu:latest.deleteSheet&&live('[data-alpha-calendar-delete-sheet]')?latest.deleteSheet.cancel:null;
  if(!close)return;event.preventDefault();event.stopImmediatePropagation();close();
 };
 p.componentDidMount=function(){mount.call(this);window.addEventListener('alpha-back',back,true);};
 p.componentWillUnmount=function(){window.removeEventListener('alpha-back',back,true);menu.ref(null);sheet.ref(null);unmount.call(this);};
}
