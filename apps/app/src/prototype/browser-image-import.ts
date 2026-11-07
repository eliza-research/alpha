import './scan-dialog.css';
import type {ImportedCameraImage} from './browser-camera';
async function prepare(file:File,signal:AbortSignal):Promise<ImportedCameraImage>{
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||!file.size||file.size>16*1024*1024)throw Error('Choose a JPEG, PNG or WebP image up to 16 MB.');
 const bitmap=await createImageBitmap(file);
 try{
  signal.throwIfAborted();if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>32_000_000)throw Error('Choose an image with at most 32 million pixels.');
  const scale=Math.min(1,2048/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image processing is unavailable.');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const image=canvas.toDataURL('image/jpeg',.9);signal.throwIfAborted();if(!image.startsWith('data:image/jpeg;base64,')||image.length>12_000_000)throw Error('This image could not be prepared.');
  return {original:file,image,width:canvas.width,height:canvas.height};
 }finally{bitmap.close();}
}
/** File selection is a draft; saving and scanning are separate explicit actions. */
export function openCameraImageImport(save:(image:ImportedCameraImage,signal:AbortSignal)=>Promise<void>,scan:(image:Blob)=>void):()=>void{
 const controller=new AbortController(),previous=document.activeElement;let current:ImportedCameraImage|undefined,selection=0,closed=false,attempted=false;
 const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Choose camera image');dialog.className='scan-dialog';
 const heading=document.createElement('h2');heading.textContent='Choose an image';
 const description=document.createElement('p');description.textContent='Choose a local JPEG, PNG or WebP. Scan runs locally. Save to Photos creates a JPEG copy up to 2,048 pixels; your original file stays unchanged.';
 const label=document.createElement('label');label.textContent='Image file';const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.setAttribute('aria-label','Image file');input.style.cssText='display:block;max-width:100%;margin:12px 0';label.append(input);
 const preview=document.createElement('img');preview.alt='Selected image preview';preview.hidden=true;preview.style.cssText='width:100%;max-height:220px;object-fit:contain';
 const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-label','Image import status');status.textContent='Nothing is saved or scanned until you choose an action.';
 const actions=document.createElement('div');actions.className='scan-dialog-actions';
 const button=(text:string)=>{const b=document.createElement('button');b.textContent=text;b.type='button';actions.append(b);return b;};
 const store=button('Save to Photos'),read=button('Scan text'),close=button('Cancel');store.disabled=read.disabled=true;store.className='primary';
 const dispose=()=>{if(closed)return;closed=true;selection++;controller.abort();current=undefined;preview.removeAttribute('src');input.value='';dialog.remove();window.removeEventListener('alpha-back',back,true);window.removeEventListener('pagehide',dispose);document.removeEventListener('visibilitychange',visibility);if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
 const back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();dispose();},visibility=()=>{if(document.hidden)dispose();};
 window.addEventListener('alpha-back',back,true);window.addEventListener('pagehide',dispose);document.addEventListener('visibilitychange',visibility);
 close.onclick=dispose;dialog.onclose=dispose;dialog.oncancel=event=>{event.preventDefault();dispose();};
 input.onchange=()=>{if(closed||attempted)return;const file=input.files?.[0];if(!file)return;const token=++selection;current=undefined;store.disabled=read.disabled=true;preview.hidden=true;preview.removeAttribute('src');status.textContent='Checking image…';void prepare(file,controller.signal).then(image=>{if(closed||token!==selection)return;current=image;preview.src=image.image;preview.hidden=false;store.disabled=read.disabled=false;status.textContent=`${file.name} · ${image.width} × ${image.height} copy`;},()=>{if(!closed&&token===selection)status.textContent='Choose a readable JPEG, PNG or WebP up to 16 MB and 32 million pixels.';});};
 store.onclick=()=>{if(closed||attempted||!current)return;attempted=true;input.disabled=store.disabled=read.disabled=true;status.textContent='Saving copy…';void save(current,controller.signal).then(()=>{if(!closed)dispose();},()=>{if(!closed)status.textContent='Save unconfirmed. Check Photos before importing again.';});};
 read.onclick=()=>{if(closed||attempted||!current)return;const image=current.original;dispose();scan(image);};
 const content=document.createElement('div');content.className='scan-dialog-content';content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Review details');content.append(description,label,preview,status);dialog.append(heading,content,actions);(document.querySelector('.os')||document.body).append(dialog);dialog.showModal();input.focus();return dispose;
}
