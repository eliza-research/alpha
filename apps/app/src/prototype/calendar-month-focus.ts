import {createInlineModal} from '../runtime/inline-modal';
type Bag=Record<string,any>;
/** Month selection owns focus without allowing covered day controls to act. */
export function installCalendarMonthFocus(Component:any,views:Bag){
 const render=views.calendar.render;let close=()=>{},container:HTMLElement|null=null;
 const modal=createInlineModal(()=>close(),()=>document.querySelector<HTMLElement>('button[aria-label="Month view"]'));
 views.calendar.render=(state:Bag,api:Bag)=>{const out=render(state,api);close=out.closeMonth;return {...out,monthModalRef:ref};};
 const ref=(element:HTMLElement|null)=>{container=element;modal.ref(element);};
 const p=Component.prototype,mount=p.componentDidMount,unmount=p.componentWillUnmount;
 const back=(event:Event)=>{if(!container?.isConnected||container.closest('[inert]'))return;event.preventDefault();event.stopImmediatePropagation();close();};
 p.componentDidMount=function(){mount.call(this);window.addEventListener('alpha-back',back,true);};
 p.componentWillUnmount=function(){window.removeEventListener('alpha-back',back,true);ref(null);unmount.call(this);};
}
