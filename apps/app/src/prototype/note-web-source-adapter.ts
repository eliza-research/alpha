import {webSourceOf} from './summary-source';
type Bag=Record<string,any>;
/** Source navigation is a user action, never an automatic fetch during note rendering. */
export function installNoteWebSourceAdapter(views:Bag){
 const notes=views.notes,render=notes.render,leave=notes.onLeave;let closeCurrent:(()=>void)|undefined;
 notes.onLeave=(...args:any[])=>{closeCurrent?.();leave?.(...args);};
 notes.render=(state:Bag,api:Bag)=>{
  const out=render(state,api),selected=state.list?.find((n:Bag)=>n.id===state.open);
  out.hasWebSource=!!webSourceOf(selected?.webSource);
  out.openWebSource=()=>{
   closeCurrent?.();const note=api.get('notes').list.find((n:Bag)=>n.id===api.get('notes').open),source=webSourceOf(note?.webSource);if(!source)return;
   const expected=JSON.stringify(note),controller=new AbortController();let closed=false,busy=false;
   const dialog=document.createElement('dialog');dialog.className='note-source-dialog';dialog.setAttribute('aria-label','Note web source');
   const theme=document.querySelector('.os');if(theme){const style=getComputedStyle(theme);for(const token of ['bg','fg'])dialog.style.setProperty('--source-'+token,style.getPropertyValue('--'+token));}
   const heading=document.createElement('h2');heading.textContent=source.name;heading.style.overflowWrap='anywhere';
   const content=document.createElement('div');content.className='note-source-content';content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Note web source details');const address=document.createElement('p');address.textContent=source.url;address.style.overflowWrap='anywhere';const detail=document.createElement('p');detail.textContent='This link opens the current web page. Its contents may have changed since the summary was saved.';content.append(heading,address,detail);
   const status=document.createElement('p');status.setAttribute('role','status');content.append(status);const footer=document.createElement('footer');
   const button=(label:string)=>{const b=document.createElement('button');b.textContent=label;footer.append(b);return b;};const open=button('Open source page'),remove=button('Remove web source'),done=button('Done');
   const previous=document.activeElement;const current=()=>!closed&&api.isActive()&&api.get('notes').open===note.id&&JSON.stringify(api.get('notes').list.find((n:Bag)=>n.id===note.id))===expected;
   const close=()=>{if(closed)return;closed=true;controller.abort();dialog.remove();window.removeEventListener('alpha-back',back,true);window.removeEventListener('pagehide',close);document.removeEventListener('visibilitychange',visibility);if(closeCurrent===close)closeCurrent=undefined;if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
   const back=(e:Event)=>{e.preventDefault();e.stopImmediatePropagation();close();},visibility=()=>{if(document.hidden)close();};
   const run=async(action:()=>Promise<void>)=>{if(busy||!current())return;busy=true;open.disabled=remove.disabled=true;try{await action();}catch{if(!closed)status.textContent='Action is unconfirmed. Reopen Notes before trying again.';}};
   open.onclick=()=>void run(async()=>{await api.openReviewedWebSource(source.url,controller.signal);close();});
   remove.onclick=()=>void run(async()=>{const state=api.get('notes'),record={...note};delete record.webSource;const saved=await api.saveImportedNote({list:state.list.map((n:Bag)=>n.id===note.id?record:n)});if(saved)close();else throw Error('Unconfirmed save');});
   done.onclick=close;dialog.oncancel=e=>{e.preventDefault();close();};dialog.append(content,footer);document.body.append(dialog);closeCurrent=close;window.addEventListener('alpha-back',back,true);window.addEventListener('pagehide',close);document.addEventListener('visibilitychange',visibility);dialog.showModal();done.focus();
  };return out;
 };
}
