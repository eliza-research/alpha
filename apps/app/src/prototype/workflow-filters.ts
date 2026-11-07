import {iconStyle} from '../icon-style';
import {holdPhoneInert} from '../runtime/modal-inert';
export type WorkflowTypeFilter='all'|'reminders'|'prompts'|'workflows'|'schedules';
export type WorkflowStatusFilter='all'|'active'|'inactive';
export const WORKFLOW_TYPES=[['all','All types'],['reminders','Reminders'],['prompts','Prompts'],['workflows','Workflows'],['schedules','Schedules']] as const;
export const WORKFLOW_STATUSES=[['all','All'],['active','Active'],['inactive','Inactive']] as const;
export function workflowFilterLabel(type:WorkflowTypeFilter,status:WorkflowStatusFilter):string {
 const name=type==='all'?'All workflows':WORKFLOW_TYPES.find(([key])=>key===type)![1];
 return name+(status==='all'?'':` · ${WORKFLOW_STATUSES.find(([key])=>key===status)![1]}`);
}
/** Presentation only: choices apply together; dismissing never changes the feed. */
export function openWorkflowFilters(input:{type:WorkflowTypeFilter;status:WorkflowStatusFilter;current():boolean;apply(type:WorkflowTypeFilter,status:WorkflowStatusFilter):void;refresh():void;busy:boolean;closed?():void}):()=>void {
 const previous=document.activeElement as HTMLElement|null,dialog=document.createElement('dialog');dialog.className='workflow-filter-sheet';dialog.setAttribute('aria-label','Filter workflows');
 const phone=document.querySelector<HTMLElement>('.os');if(phone){const theme=getComputedStyle(phone);for(const key of ['bg','fg','mut','line','s2','acc','acct'])dialog.style.setProperty('--'+key,theme.getPropertyValue('--'+key));}
 const release=holdPhoneInert(phone);let done=false,type=input.type,status=input.status;
 const close=()=>{if(done)return;done=true;window.removeEventListener('alpha-back',back,true);window.removeEventListener('pagehide',close);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('resize',position);dialog.remove();release();input.closed?.();if(previous?.isConnected)previous.focus();};
 const back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();close();},visibility=()=>{if(document.hidden)close();};
 const position=()=>{const rect=phone?.getBoundingClientRect(),width=Math.max(0,Math.min(rect?.width??innerWidth,innerWidth)-24);dialog.style.width=Math.min(400,width)+'px';dialog.style.left=Math.max(12,(rect?.left??0)+((rect?.width??innerWidth)-Math.min(400,width))/2)+'px';dialog.style.bottom=Math.max(12,innerHeight-(rect?.bottom??innerHeight)+12)+'px';};
 const glyph=(name:string)=>{const span=document.createElement('span');span.setAttribute('aria-hidden','true');span.dataset.alphaIcon='/icons/lucide/'+name+'.svg';Object.assign(span.style,iconStyle(name));return span;};
 const button=(label:string)=>{const b=document.createElement('button');b.type='button';b.textContent=label;return b;};
 const header=document.createElement('header'),title=document.createElement('h2');title.textContent='Filter workflows';const cancel=button('');cancel.className='workflow-filter-close';cancel.setAttribute('aria-label','Close filters');cancel.append(glyph('x'));cancel.onclick=close;header.append(title,cancel);
 const content=document.createElement('div');content.className='workflow-filter-content';
 const groups:Array<{element:HTMLElement;buttons:HTMLButtonElement[];paint():void}>=[];
 function group<T extends string>(label:string,items:readonly(readonly[T,string])[],selected:()=>string,pick:(key:T)=>void,compact=false){
  const heading=document.createElement('h3');heading.textContent=label;const group=document.createElement('div');group.className=compact?'workflow-status-options':'workflow-type-options';group.setAttribute('role','radiogroup');group.setAttribute('aria-label',label);
  const buttons=items.map(([key,name])=>{const b=button(name);b.setAttribute('role','radio');b.onclick=()=>{pick(key);groups.forEach(g=>g.paint());};group.append(b);return b;});
  const paint=()=>buttons.forEach((b,i)=>{const checked=selected()===items[i][0];b.setAttribute('aria-checked',String(checked));b.tabIndex=checked?0:-1;if(!compact){b.querySelector('[data-alpha-icon]')?.remove();if(checked)b.append(glyph('check'));}});
  group.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();const index=buttons.indexOf(document.activeElement as HTMLButtonElement),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'||event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next].click();buttons[next].focus();};
  groups.push({element:group,buttons,paint});content.append(heading,group);
 }
 group('Type',WORKFLOW_TYPES,()=>type,value=>type=value);
 group('Status',WORKFLOW_STATUSES,()=>status,value=>status=value,true);
 const refresh=button('Refresh list');refresh.className='workflow-filter-refresh';refresh.prepend(glyph('rotate-cw'));refresh.disabled=input.busy;refresh.onclick=()=>{if(!input.current()){close();return;}close();input.refresh();};content.append(refresh);
 const footer=document.createElement('footer'),apply=button('Show workflows');apply.className='workflow-filter-apply';apply.onclick=()=>{if(input.current())input.apply(type,status);close();};footer.append(apply);dialog.append(header,content,footer);
 dialog.oncancel=event=>{event.preventDefault();close();};dialog.onclose=close;dialog.onclick=event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}};
 window.addEventListener('alpha-back',back,true);window.addEventListener('pagehide',close);document.addEventListener('visibilitychange',visibility);window.addEventListener('resize',position);
 try{document.body.append(dialog);position();groups.forEach(g=>g.paint());dialog.showModal();cancel.focus();}catch(error){close();throw error;}
 return close;
}
