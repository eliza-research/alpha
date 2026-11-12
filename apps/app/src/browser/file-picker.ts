let current:AbortController|undefined;
/** One owned picker at a time. Late OS results cannot resume a retired consumer. */
export async function runFilePicker<T>(choose:(signal:AbortSignal)=>Promise<T>,cancelled:T):Promise<T>{
 current?.abort();const controller=new AbortController();current=controller;const cancel=()=>controller.abort(),back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();cancel();};
 window.addEventListener('alpha-back',back,true);window.addEventListener('pagehide',cancel);window.addEventListener('alpha:device-state',cancel);
 const retired=new Promise<T>(resolve=>controller.signal.addEventListener('abort',()=>resolve(cancelled),{once:true}));
 try{return await Promise.race([choose(controller.signal).catch(error=>{if(controller.signal.aborted||error instanceof DOMException&&error.name==='AbortError')return cancelled;throw error;}),retired]);}
 finally{window.removeEventListener('alpha-back',back,true);window.removeEventListener('pagehide',cancel);window.removeEventListener('alpha:device-state',cancel);if(current===controller)current=undefined;}
}
export function inputFiles(signal:AbortSignal,options:{photos?:boolean;directory?:boolean;accept?:string;multiple?:boolean}={}):Promise<File[]>{
 return new Promise((resolve,reject)=>{const input=document.createElement('input');input.type='file';input.hidden=true;input.multiple=!!options.multiple;if(options.accept)input.accept=options.accept;if(options.photos)input.accept='image/*,video/*';if(options.directory){input.setAttribute('webkitdirectory','');input.multiple=true;}
 const finish=(files:File[])=>{input.onchange=input.oncancel=null;input.remove();signal.removeEventListener('abort',cancel);resolve(files);},cancel=()=>finish([]);signal.addEventListener('abort',cancel,{once:true});input.oncancel=cancel;input.onchange=()=>finish(Array.from(input.files||[]));
 if(signal.aborted){cancel();return;}document.body.append(input);try{input.click();}catch(error){input.onchange=input.oncancel=null;input.remove();signal.removeEventListener('abort',cancel);reject(error);}
 });
}
