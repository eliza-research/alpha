import {createInlineModal} from '../runtime/inline-modal';
type Bag=Record<string,any>;
/** Month selection owns focus without allowing covered day controls to act. */
export function installCalendarMonthFocus(Component:any,views:Bag){
 const render=views.calendar.render;let close=()=>{},container:HTMLElement|null=null;
 const modal=createInlineModal(()=>close(),()=>document.querySelector<HTMLElement>('button[aria-label="Month view"]'));
 views.calendar.render=(state:Bag,api:Bag)=>{const out=render(state,api);close=out.closeMonth;
  if(out.monthOpen){
   const selected=new Date(api.now);selected.setDate(selected.getDate()+Number(state.day||0));selected.setDate(1);
   const shown=new Date(selected);shown.setMonth(shown.getMonth()+Number(state.month||0));
   const choose=(year:number,month:number)=>{if(Number.isInteger(year)&&year>=1&&year<=9999&&Number.isInteger(month)&&month>=0&&month<12)api.set({month:(year-selected.getFullYear())*12+month-selected.getMonth()});};
   out.monthNumber=String(shown.getMonth());out.yearNumber=String(shown.getFullYear());
   out.monthChoices=Array.from({length:12},(_,month)=>({value:String(month),label:new Date(2000,month,1).toLocaleDateString(undefined,{month:'long'})}));
   const first=Math.max(1,shown.getFullYear()-50),last=Math.min(9999,shown.getFullYear()+50);
   out.yearChoices=Array.from({length:last-first+1},(_,i)=>({value:String(first+i),label:String(first+i)}));
   out.chooseMonth=(event:Event)=>choose(shown.getFullYear(),Number((event.target as HTMLSelectElement).value));
   out.chooseYear=(event:Event)=>choose(Number((event.target as HTMLSelectElement).value),shown.getMonth());
  }
  return {...out,monthModalRef:ref};};
 const ref=(element:HTMLElement|null)=>{container=element;modal.ref(element);};
 const p=Component.prototype,mount=p.componentDidMount,unmount=p.componentWillUnmount;
 const back=(event:Event)=>{if(!container?.isConnected||container.closest('[inert]'))return;event.preventDefault();event.stopImmediatePropagation();close();};
 p.componentDidMount=function(){mount.call(this);window.addEventListener('alpha-back',back,true);};
 p.componentWillUnmount=function(){window.removeEventListener('alpha-back',back,true);ref(null);unmount.call(this);};
}
