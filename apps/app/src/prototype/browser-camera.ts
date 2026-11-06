import {fileArchive} from '../browser/file-archive';
import {applyPhotoFilter} from '../browser/photo-filter';
import {renderVideoEdit,validateVideoEdit,type VideoEdit} from '../browser/video-edit';
import {BrowserCameraFocus} from '../browser/camera-focus';
import {browserDevProfile} from '../browser/dev-profile';
/** A browser image chosen for Photos or kept from scan review, re-encoded as JPEG. */
export type ImportedCameraImage={original:File;image:string;width:number;height:number};
import {drawCameraFrame} from '../browser/camera-frame';
import {BrowserVideoCapture} from '../browser/video-capture';
import {albumDocument} from '../browser/preference-documents';

type Row={id:string;kind:'image'|'video';path?:string;duration?:number;operationId?:string;image:string;width:number;height:number;date:number;revision:string;mutationRevision:string;favorite:boolean;trashed:boolean};
const finder='[data-alpha-camera="viewfinder"]';
const revision=()=>crypto.randomUUID();
let database:Promise<IDBDatabase>|undefined;
function db(){return database??=new Promise<IDBDatabase>((resolve,reject)=>{
 const request=indexedDB.open('alpha.browser.photos.v1',2);
 request.onupgradeneeded=()=>{
  const store=request.result.objectStoreNames.contains('photos')?request.transaction!.objectStore('photos'):request.result.createObjectStore('photos',{keyPath:'id'});
  if(!store.indexNames.contains('chronological'))store.createIndex('chronological',['date','id']);
 };
 request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();database=undefined;};resolve(request.result);};
 request.onerror=()=>{database=undefined;reject(request.error);};
 request.onblocked=()=>{database=undefined;reject(Error('Close other Alpha tabs to open photo storage.'));};
});}
async function transaction<T>(mode:IDBTransactionMode,action:(store:IDBObjectStore,set:(value:T)=>void,fail:(error:Error)=>void)=>void):Promise<T>{
 const connection=await db();
 return new Promise((resolve,reject)=>{const tx=connection.transaction('photos',mode);let value:T,error:Error|undefined;
  tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(error??tx.error);tx.onabort=()=>reject(error??tx.error??Error('Photo storage interrupted.'));
  try{action(tx.objectStore('photos'),v=>{value=v;},e=>{error=e;tx.abort();});}catch(e){error=e as Error;tx.abort();}
 });
}
function pageCursor(row:Row){return 'date:'+JSON.stringify([row.date,row.id]);}
function pageBoundary(value:string){
 try{const key=JSON.parse(value.slice(5));if(value.startsWith('date:')&&Array.isArray(key)&&key.length===2&&Number.isFinite(key[0])&&typeof key[1]==='string'&&key[1])return key as [number,string];}catch{}
 throw Error('Photo page changed. Reopen the library.');
}
/** Every browser capture comes from Alpha's camera; the browser has no screenshots. */
const BUILT_IN_ALBUMS=['favorites','videos','camera','screenshots'];
async function rows(options:{before?:string;trashed?:boolean;album?:string}={},metadata=false){
 const custom=options.album&&!BUILT_IN_ALBUMS.includes(options.album)?(await albumDocument.read<Album[]>(()=>[])).find(a=>a.id===options.album!.replace(/^custom:/,'')):undefined;
 if(options.album&&!BUILT_IN_ALBUMS.includes(options.album)&&!custom)throw Error('Album no longer available.');
 const members=new Set(custom?.memberIds||[]);
 const boundary=options.before?pageBoundary(options.before):undefined;
 return transaction<Row[]>('readonly',(store,set)=>{const result:Row[]=[];const request=store.index('chronological').openCursor(boundary?IDBKeyRange.upperBound(boundary,true):undefined,'prev');
  request.onsuccess=()=>{const cursor=request.result;if(!cursor){set(result);return;}const row=cursor.value as Row;if(row.kind!=='image'&&row.kind!=='video'){cursor.continue();return;}
   if(metadata||(!!row.trashed===!!options.trashed&&(!options.album||options.album==='favorites'&&row.favorite||options.album==='videos'&&row.kind==='video'||options.album==='camera'||members.has(row.id))))result.push(metadata?{...row,image:'',path:undefined}:row);
   if(!metadata&&result.length>=41){set(result);return;}cursor.continue();
  };
 });
}
async function read(id:string){return transaction<Row>('readonly',(store,set,fail)=>{const r=store.get(id);r.onsuccess=()=>['image','video'].includes(r.result?.kind)?set(r.result):fail(Error('Photo no longer available.'));});}
async function change(input:{id:string;revision:string},patch:Partial<Pick<Row,'favorite'|'trashed'>>){
 return transaction<Row>('readwrite',(store,set,fail)=>{const r=store.get(input.id);r.onsuccess=()=>{const row=r.result as Row|undefined;
  if(!row||!['image','video'].includes(row.kind)||row.mutationRevision!==input.revision){fail(Error('Photo changed in another tab. Reopen it and try again.'));return;}
  const updated={...row,...patch,mutationRevision:revision()};store.put(updated);set(updated);
 };});
}
type EditParameters={rotation:number;crop:boolean;filter:string};
type EditSession={id:string;source:Row;active:boolean;expiresAt:number};
type EditRecord={id:string;kind:'edit-receipt';operationId:string;sourceId:string;sourceRevision:string;copyId:string;status:'prepared'|'saving'|'saved'|'failed'|'cancelled'|'unchanged';parameters?:string;attempt?:string;replace?:boolean};
type EditResult={status:string;operationId:string;id?:string;replaced?:boolean};
const edits=new Map<string,EditSession>();
const filters:Record<string,string>={none:'none',vivid:'saturate(1.55) contrast(1.08)',warm:'sepia(.3) saturate(1.35) hue-rotate(-8deg)',cool:'saturate(1.1) hue-rotate(14deg) brightness(1.03)',mono:'grayscale(1) contrast(1.05)',fade:'contrast(.78) brightness(1.12) saturate(.75)',noir:'grayscale(1) contrast(1.55) brightness(.88)'};
const photoId=()=>Date.now().toString().padStart(13,'0')+Array.from(crypto.getRandomValues(new Uint8Array(12)),n=>String(n%10)).join('');
function editKey(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid edit identity.');return 'edit:'+id;}
function parameters(input:EditParameters){if(![0,90,180,270].includes(input.rotation)||typeof input.crop!=='boolean'||!Object.hasOwn(filters,input.filter))throw Error('Invalid photo transform.');return JSON.stringify([input.rotation,input.crop,input.filter]);}
function session(id:string){const value=edits.get(id);if(!value?.active||Date.now()>value.expiresAt)throw Error('Reopen the photo editor.');return value;}
function outcome(record:EditRecord):EditResult{return {operationId:record.operationId,status:record.status==='saved'?'saved':record.status==='failed'?'failed':record.status==='unchanged'?'unchanged':'not-started',...(record.status==='saved'?{id:record.replace?record.sourceId:record.copyId,...(record.replace?{replaced:true}:{})}:{})};}
async function renderEdit(value:EditSession,input:EditParameters){
 input={rotation:input.rotation,crop:input.crop,filter:input.filter};
 parameters(input);session(value.id);
 const image=new Image();image.src=value.source.image;await image.decode();session(value.id);
 if(image.naturalWidth!==value.source.width||image.naturalHeight!==value.source.height)throw Error('Photo dimensions changed.');
 const crop=input.crop?1.3:1,sw=image.naturalWidth/crop,sh=image.naturalHeight/crop;
 const rotated=input.rotation===90||input.rotation===270,scale=Math.min(1,2048/Math.max(sw,sh));
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round((rotated?sh:sw)*scale));canvas.height=Math.max(1,Math.round((rotated?sw:sh)*scale));
 const context=canvas.getContext('2d');if(!context)throw Error('Photo editing is unavailable.');
 const nativeFilter='filter' in context;if(nativeFilter)context.filter=filters[input.filter];context.translate(canvas.width/2,canvas.height/2);context.rotate(input.rotation*Math.PI/180);
 context.drawImage(image,(image.naturalWidth-sw)/2,(image.naturalHeight-sh)/2,sw,sh,-sw*scale/2,-sh*scale/2,sw*scale,sh*scale);
 if(!nativeFilter)applyPhotoFilter(context,canvas.width,canvas.height,filters[input.filter]);
 const encoded=canvas.toDataURL('image/jpeg',0.9);if(!encoded.startsWith('data:image/jpeg;base64,')||encoded.length>12_000_000)throw Error('Edited photo could not be encoded.');
 // Browser captures are Alpha's own: Replace may overwrite them in place.
 return {sessionId:value.id,operationId:value.id,image:encoded,width:canvas.width,height:canvas.height,reduced:scale<1,maxEdge:2048,filter:input.filter,canReplace:true};
}
async function beginPhotoEdit(input:{id:string;revision:string}){
 for(const value of edits.values())if(Date.now()>value.expiresAt)await cancelPhotoEdit({sessionId:value.id});
 if(edits.size>=4)throw Error('Close another photo editor first.');
 const source=await read(input.id);if(source.trashed||source.mutationRevision!==input.revision)throw Error('Photo changed. Reopen it before editing.');
 const id=revision(),value:EditSession={id,source,active:true,expiresAt:Date.now()+15*60*1000};edits.set(id,value);
 try{
  const preview=await renderEdit(value,{rotation:0,crop:false,filter:'none'});
  const record:EditRecord={id:editKey(id),kind:'edit-receipt',operationId:id,sourceId:source.id,sourceRevision:source.mutationRevision,copyId:photoId(),status:'prepared'};
  await transaction<void>('readwrite',(store,set)=>{store.add(record);set(undefined);});return preview;
 }catch(error){edits.delete(id);value.active=false;throw error;}
}
async function previewPhotoEdit(input:EditParameters&{sessionId:string}){return renderEdit(session(input.sessionId),input);}
async function resultPhotoEdit(input:{operationId:string}):Promise<EditResult>{
 // Reading an uncommitted outcome retires its authority in the same transaction.
 // A suspended save cannot commit later after recovery reported no copy.
 return transaction<EditResult>('readwrite',(store,set)=>{const request=store.get(editKey(input.operationId));request.onsuccess=()=>{
  const record=request.result as EditRecord|undefined;
  if(!record){set({status:'not-started',operationId:input.operationId});return;}
  if(record.status==='prepared'||record.status==='saving'){record.status='cancelled';store.put(record);}
  set(outcome(record));
 };});
}
async function cancelPhotoEdit(input:{sessionId:string}){const value=edits.get(input.sessionId);if(value)value.active=false;edits.delete(input.sessionId);await resultPhotoEdit({operationId:input.sessionId});}
async function savePhotoEdit(input:EditParameters&{sessionId:string;replace?:boolean}):Promise<EditResult>{
 const replace=input.replace===true;
 input={sessionId:input.sessionId,rotation:input.rotation,crop:input.crop,filter:input.filter};
 // The mode is part of the save's identity: a retry cannot turn a copy into a replace.
 const encodedParameters=parameters(input)+(replace?':replace':''),key=editKey(input.sessionId),attempt=revision();
 const claimed=await transaction<EditRecord>('readwrite',(store,set,fail)=>{const request=store.get(key);request.onsuccess=()=>{
  const record=request.result as EditRecord|undefined;
  if(!record){fail(Error('Reopen the photo editor.'));return;}
  if(record.parameters&&record.parameters!==encodedParameters){fail(Error('This save already refers to another edit.'));return;}
  if(record.status==='saved'||record.status==='failed'||record.status==='cancelled'||record.status==='unchanged'){set(record);return;}
  if(record.status==='saving'){fail(Error('Save is already in progress. Check its existing outcome.'));return;}
  record.status=input.rotation===0&&!input.crop&&input.filter==='none'?'unchanged':'saving';record.parameters=encodedParameters;record.attempt=attempt;record.replace=replace;store.put(record);set(record);
 };});
 if(claimed.status!=='saving')return outcome(claimed);
 try{
  const value=session(input.sessionId),rendered=await renderEdit(value,input);session(input.sessionId);
  return await transaction<EditResult>('readwrite',(store,set)=>{const request=store.get(key);request.onsuccess=()=>{
   const record=request.result as EditRecord;
   if(record.status!=='saving'||record.attempt!==attempt){set(outcome(record));return;}
   const original=store.get(record.sourceId);original.onsuccess=()=>{
    const source=original.result as Row|undefined;
    if(!value.active||Date.now()>value.expiresAt||!source||source.trashed||source.mutationRevision!==record.sourceRevision){record.status='failed';store.put(record);set(outcome(record));return;}
    // Replace overwrites the reviewed revision in place (new revisions, same id and date);
    // a copy and its receipt either both commit or neither does, and the original is not written.
    if(record.replace)store.put({...source,image:rendered.image,width:rendered.width,height:rendered.height,revision:revision(),mutationRevision:revision()});
    else store.add({id:record.copyId,kind:'image',image:rendered.image,width:rendered.width,height:rendered.height,date:Date.now(),revision:revision(),mutationRevision:revision(),favorite:false,trashed:false} satisfies Row);
    record.status='saved';store.put(record);set(outcome(record));
   };
  };});
 }catch(error){
  await transaction<void>('readwrite',(store,set)=>{const request=store.get(key);request.onsuccess=()=>{const record=request.result as EditRecord|undefined;if(record?.status==='saving'&&record.attempt===attempt){record.status='failed';store.put(record);}set(undefined);};});throw error;
 }
}

type Album={id:string;name:string;revision:string;count:number;memberIds:string[]};
const mediaId=()=>Date.now().toString().padStart(13,'0')+Array.from(crypto.getRandomValues(new Uint8Array(12)),n=>String(n%10)).join('');
const prepared=new Map<string,{id:string;revision:string}[]>();
type SelectedMedia={id:string;revision:string};
/** Share and save hand one set to the system at once; changes are batched by the caller. */
export const SHARE_LIMIT=100;
function selectedMedia(items:SelectedMedia[],limit=20){
 if(!Array.isArray(items)||items.length<1||items.length>limit||items.some(item=>!item||typeof item.id!=='string'||!item.id||typeof item.revision!=='string'||!item.revision)||new Set(items.map(item=>item.id)).size!==items.length)throw Error(`Select between 1 and ${limit} distinct items again.`);
 return items.map(item=>({id:item.id,revision:item.revision}));
}
// Same rule as the shared TrashDeleteRequest: emptying the trash is only the explicit {all:true}
// intent; no intent, both, items:null or a non-list items value is refused, never read as all trash.
function trashSelection(input:unknown):SelectedMedia[]|null{
 const value=input as {items?:unknown;all?:unknown}|null|undefined;
 if(!value||typeof value!=='object'||('all' in value)===('items' in value))throw Error('Select deleted items again.');
 if('all' in value){if(value.all!==true)throw Error('Select deleted items again.');return null;}
 return selectedMedia(value.items as SelectedMedia[],2000);
}
async function selectedMediaRows(items:SelectedMedia[]){
 return transaction<Row[]>('readonly',(store,set,fail)=>{const result:Row[]=[];set(result);for(const item of items){const request=store.get(item.id);request.onsuccess=()=>{const row=request.result as Row|undefined;if(!row||!['image','video'].includes(row.kind)||row.mutationRevision!==item.revision||row.trashed){fail(Error('Selection changed. Reselect the items.'));return;}result.push(row);};}});
}
async function selectedMediaFiles(items:SelectedMedia[]){
  const selected=await selectedMediaRows(items);
  // Validate the entire selection before preparing a handoff or explicit save.
  return Promise.all(selected.map(async(row,index)=>{
   const source=row.path||row.image;
   if(!/^data:(image|video)\//.test(source))throw Error('Select saved local media.');
   const response=await fetch(source),blob=await response.blob();
   const extension=blob.type==='video/mp4'?'mp4':blob.type.startsWith('video/')?'webm':blob.type==='image/png'?'png':'jpg';
   return new File([blob],`Alpha-${row.kind==='video'?'video':'photo'}-${selected.length===1?row.id:index+1}.${extension}`,{type:blob.type});
  }));
}
export async function saveBrowserMedia(input:{items:SelectedMedia[]},current:()=>boolean){
 if(!current())throw new DOMException('Share view changed','AbortError');
 const items=selectedMedia(input.items,SHARE_LIMIT),files=await selectedMediaFiles(items);
 const blob=files.length===1?files[0]:fileArchive(await Promise.all(files.map(async file=>({path:file.name,bytes:new Uint8Array(await file.arrayBuffer())}))));
 await selectedMediaRows(items);
 if(document.hidden||!current())throw new DOMException('Share view changed','AbortError');
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=files.length===1?files[0].name:'Alpha photos.zip';document.body.append(link);
 try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
}
async function saveVideoCopy(input:{id:string;revision:string;operationId:string;edit:VideoEdit},signal:AbortSignal):Promise<EditResult>{
 const key=editKey(input.operationId),edit={...input.edit},source=await read(input.id);signal.throwIfAborted();
 if(source.kind!=='video'||!source.path||!source.duration)throw Error('Select a saved video.');validateVideoEdit(edit,source.duration);
 const encoded=JSON.stringify([edit.start,edit.end,edit.rotation,edit.crop]);
 const claimed=await transaction<EditRecord>('readwrite',(store,set,fail)=>{signal.throwIfAborted();const request=store.get(key);request.onsuccess=()=>{const old=request.result as EditRecord|undefined;if(old){if(old.sourceId!==input.id||old.sourceRevision!==input.revision||old.parameters!==encoded){fail(Error('This operation belongs to another edit.'));return;}if(old.status==='saving'){fail(Error('Video save is in progress.'));return;}set(old);return;}const record:EditRecord={id:key,kind:'edit-receipt',operationId:input.operationId,sourceId:input.id,sourceRevision:input.revision,copyId:'v:'+photoId(),parameters:encoded,status:'saving'};store.add(record);set(record);};});
 if(claimed.status!=='saving')return outcome(claimed);
 try{
  if(source.trashed||source.mutationRevision!==input.revision)throw Error('Video changed. Reopen it before editing.');
  const rendered=await renderVideoEdit({path:source.path,duration:source.duration},edit,signal);signal.throwIfAborted();
  return await transaction<EditResult>('readwrite',(store,set,fail)=>{const request=store.get(key);request.onsuccess=()=>{const record=request.result as EditRecord;if(record.status!=='saving'){set(outcome(record));return;}const original=store.get(input.id);original.onsuccess=()=>{const row=original.result as Row|undefined;if(signal.aborted||!row||row.trashed||row.mutationRevision!==input.revision){record.status='failed';store.put(record);set(outcome(record));return;}try{store.add({id:record.copyId,kind:'video',...rendered,date:Date.now(),revision:revision(),mutationRevision:revision(),favorite:false,trashed:false});record.status='saved';store.put(record);set(outcome(record));}catch(error){fail(error instanceof Error?error:Error('Video copy could not be saved.'));}};};});
 }catch(error){await transaction<void>('readwrite',(store,set)=>{const request=store.get(key);request.onsuccess=()=>{const record=request.result as EditRecord;if(record.status==='saving'){record.status='failed';store.put(record);}set(undefined);};});throw error;}
}
export const browserPhotoLibrary={
 saveVideoCopy,
 beginEdit:beginPhotoEdit,previewEdit:previewPhotoEdit,saveEdit:savePhotoEdit,editResult:resultPhotoEdit,cancelEdit:cancelPhotoEdit,
 async list(options:{before?:string;trashed?:boolean;album?:string;limit?:number}={}){const result=await rows(options),page=Math.max(1,Math.min(40,Math.floor(options.limit??40)||40));return {items:result.slice(0,page),next:result.length>page?pageCursor(result[page-1]):''};},
 async read(input:{id:string}){return read(input.id);},
 async summary(){const all=await rows({},true);return {favorites:all.filter(r=>!r.trashed&&r.favorite).length,videos:all.filter(r=>!r.trashed&&r.kind==='video').length,camera:all.filter(r=>!r.trashed).length,screenshots:0,trash:all.filter(r=>r.trashed).length,canFavorite:true};},
 async albums(){const live=new Set((await rows({},true)).filter(row=>!row.trashed).map(row=>row.id));return {items:(await albumDocument.read<Album[]>(()=>[])).map(album=>({...album,count:album.memberIds.filter(id=>live.has(id)).length}))};},
 async shareMany(input:{items:SelectedMedia[]},current:()=>boolean){
  if(!current())throw new DOMException('Share view changed','AbortError');
  const items=selectedMedia(input.items,SHARE_LIMIT),files=await selectedMediaFiles(items);
  await selectedMediaRows(items);
  if(document.hidden||!current())throw new DOMException('Share view changed','AbortError');
  if(!navigator.share||!navigator.canShare?.({files}))throw Error('Sharing is unavailable in this browser. Use Save locally.');
  await navigator.share({files});
  return {status:'opened',count:files.length};
 },
 async changeAlbum(input:Record<string,unknown>){
  if(!['create','rename','delete','add','remove'].includes(String(input.operation)))throw Error('Unknown album operation.');
  const name=typeof input.name==='string'?input.name.trim():'';
  if(['create','rename'].includes(String(input.operation))&&(!name||name.length>80||/[\u0000-\u001f\u007f]/.test(name)))throw Error('Choose an album name between 1 and 80 characters.');
  return albumDocument.edit<Album[],{status:string;id:string;revision:string}>(()=>[],async albums=>{
   let media:Row|undefined;
   if(input.operation==='add'||input.operation==='remove'||input.operation==='create'&&(input.mediaId!==undefined||input.mediaRevision!==undefined)){
    if(typeof input.mediaId!=='string'||typeof input.mediaRevision!=='string')throw Error('Select the photo again.');
    media=await read(input.mediaId);if(media.mutationRevision!==input.mediaRevision||media.trashed)throw Error('Photo changed. Reopen it.');
   }
   if(input.operation==='create'){const memberIds=media?[media.id]:[],album:Album={id:crypto.randomUUID(),name,revision:revision(),count:memberIds.length,memberIds};albums.push(album);return {status:'updated',id:album.id,revision:album.revision};}
   const album=albums.find(a=>a.id===input.id);if(!album||album.revision!==input.revision)throw Error('Album changed. Reopen it.');
   if(input.operation==='delete')albums.splice(albums.indexOf(album),1);
   else if(input.operation==='rename')album.name=name;
   else {album.memberIds=album.memberIds.filter(id=>id!==media!.id);if(input.operation==='add')album.memberIds.push(media!.id);}
   album.revision=revision();album.count=album.memberIds.length;return {status:'updated',id:album.id,revision:album.revision};
  });
 },
 async setFavorite(input:{id:string;revision:string;favorite:boolean}){return change(input,{favorite:input.favorite});},
 async setTrashed(input:{id:string;revision:string;trashed:boolean}){return {...await change(input,{trashed:input.trashed}),status:'updated'};},
 async changeMany(input:{operation:'favorite'|'unfavorite'|'trash'|'restore';items:SelectedMedia[]}){
  if(!['favorite','unfavorite','trash','restore'].includes(input.operation))throw Error('Unknown photo operation.');
  const items=selectedMedia(input.items),patch=input.operation==='favorite'||input.operation==='unfavorite'?{favorite:input.operation==='favorite'}:{trashed:input.operation==='trash'};
  return transaction<{status:string;outcomes:{id:string;status:string;item?:Row}[]}>('readwrite',(store,set)=>{
   const result={status:'complete',outcomes:[] as {id:string;status:string;item?:Row}[]};set(result);
   for(const item of items){const request=store.get(item.id);request.onsuccess=()=>{
    const row=request.result as Row|undefined;
    if(!row||!['image','video'].includes(row.kind)||row.mutationRevision!==item.revision||(input.operation==='favorite'||input.operation==='unfavorite')&&row.trashed){result.outcomes.push({id:item.id,status:'conflict'});return;}
    const unchanged=Object.entries(patch).every(([key,value])=>row[key as 'favorite'|'trashed']===value);
    const updated=unchanged?row:{...row,...patch,mutationRevision:revision()};if(!unchanged)store.put(updated);
    result.outcomes.push({id:item.id,status:unchanged?'unchanged':'updated',item:updated});
   };}
  });
 },
 async share(input:{id:string;revision?:string},current:()=>boolean){const row=await read(input.id);return browserPhotoLibrary.shareMany({items:[{id:input.id,revision:input.revision??row.mutationRevision}]},current);},
 async prepareDeleteTrash(input:{items:SelectedMedia[]}|{all:true}){const wanted=trashSelection(input);const all=(await rows({},true)).filter(r=>r.trashed);if(wanted&&wanted.some(item=>!all.some(row=>row.id===item.id&&row.mutationRevision===item.revision)))throw Error('Selected deleted items changed. Select them again.');const selected=wanted||all.map(r=>({id:r.id,revision:r.mutationRevision}));const confirmation=revision();prepared.clear();prepared.set(confirmation,selected);return {confirmation,count:selected.length};},
 async cancelDeleteTrash(input:{confirmation:string}){prepared.delete(input.confirmation);},
 async deletePreparedTrash(input:{confirmation:string}){const selected=prepared.get(input.confirmation);if(!selected)throw Error('Review the trash again.');prepared.delete(input.confirmation);
  return transaction<{status:string;deletedIds:string[];skippedIds:string[];failedIds:string[]}>('readwrite',(store,set)=>{const result={status:'complete',deletedIds:[] as string[],skippedIds:[] as string[],failedIds:[] as string[]};set(result);for(const item of selected){const r=store.get(item.id);r.onsuccess=()=>{const row=r.result as Row|undefined;if(row?.trashed&&row.mutationRevision===item.revision){store.delete(item.id);result.deletedIds.push(item.id);}else result.skippedIds.push(item.id);};}});
 },
};
export async function importBrowserPhoto(image:ImportedCameraImage,signal:AbortSignal){
 signal.throwIfAborted();const row:Row={id:photoId(),kind:'image',image:image.image,width:image.width,height:image.height,date:Date.now(),revision:revision(),mutationRevision:revision(),favorite:false,trashed:false};
 await transaction<void>('readwrite',(store,set)=>{signal.throwIfAborted();store.add(row);set(undefined);});return row;
}
const unavailable=async()=>{throw Error('This operation is not available for browser photos. The original is unchanged.');};
export const browserLibrary=new Proxy(browserPhotoLibrary,{get(target,key){return Reflect.get(target,key)??unavailable;}});
const videoCapture=new BrowserVideoCapture();
let videoSession=0;
let videoSave:Promise<{path:string;duration:number;width:number;height:number;fileSize:number}>|undefined;
let preview:HTMLVideoElement|null=null,stream:MediaStream|null=null,generation=0;
let starting:AbortController|undefined;
let zoom=1,mirror=false;
const cameraFocus=new BrowserCameraFocus();
let screenLight:HTMLDivElement|undefined;
function clearScreenLight(){screenLight?.remove();screenLight=undefined;}
function setScreenLight(enabled:boolean){clearScreenLight();if(!enabled)return;const light=screenLight=document.createElement('div');light.dataset.alphaCameraLight='screen';light.setAttribute('aria-hidden','true');light.style.cssText='position:absolute;inset:0;z-index:2;pointer-events:none;box-shadow:inset 0 0 0 28px white,inset 0 0 70px 40px rgba(255,255,255,.8)';document.querySelector(finder)?.append(light);}
window.addEventListener('pagehide',()=>{clearScreenLight();cameraFocus.clear();});document.addEventListener('visibilitychange',()=>{if(document.hidden){clearScreenLight();cameraFocus.clear();}});

function release(video:HTMLVideoElement|null,media:MediaStream|null){media?.getTracks().forEach(track=>track.stop());if(video){video.pause();video.srcObject=null;video.remove();}}
export function mountBrowserCamera(){const frame=document.querySelector<HTMLElement>(finder);if(preview&&frame&&preview.parentElement!==frame)frame.prepend(preview);}
export const browserCamera={
 async startPreview(options:{direction:'front'|'back';resolution:{width:number;height:number};mirror:boolean}){
  void browserCamera.stopPreview();const token=++generation,controller=new AbortController();starting=controller;
  let ownStream:MediaStream|null=null,ownVideo:HTMLVideoElement|null=null;
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera access is unavailable here.');
   ownStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:options.direction==='front'?'user':'environment',width:{ideal:options.resolution.width},height:{ideal:options.resolution.height}}});
   controller.signal.throwIfAborted();if(token!==generation)throw Error('Camera cancelled.');
   const frame=document.querySelector<HTMLElement>(finder);if(!frame)throw Error('Camera view is closed.');
   ownVideo=document.createElement('video');ownVideo.srcObject=ownStream;ownVideo.autoplay=true;ownVideo.playsInline=true;ownVideo.muted=true;
   ownVideo.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;z-index:1'+(options.mirror?';transform:scaleX(-1)':'');
   preview=ownVideo;stream=ownStream;zoom=1;mirror=options.mirror;frame.prepend(ownVideo);
   await new Promise<void>((resolve,reject)=>{
    const finish=(error?:unknown)=>{clearTimeout(timeout);controller.signal.removeEventListener('abort',abort);error?reject(error):resolve();};
    const abort=()=>finish(new DOMException('Camera cancelled.','AbortError'));
    const timeout=setTimeout(()=>finish(Error('Camera preview timed out.')),15000);
    controller.signal.addEventListener('abort',abort,{once:true});
    if(controller.signal.aborted){abort();return;}ownVideo!.play().then(()=>finish(),finish);
   });
   controller.signal.throwIfAborted();
   ownStream.getVideoTracks()[0].addEventListener('ended',()=>{if(token===generation){clearScreenLight();cameraFocus.clear();}},{once:true});
   const settings=ownStream.getVideoTracks()[0].getSettings();return {width:ownVideo.videoWidth,height:ownVideo.videoHeight,deviceId:settings.deviceId??'',minZoom:1,maxZoom:options.direction==='front'?1:8,hasFlash:browserCamera.flashAvailable()};
  }catch(error){release(ownVideo,ownStream);if(preview===ownVideo){preview=null;stream=null;}throw error;}
  finally{if(starting===controller)starting=undefined;}
 },
 async stopPreview(){cameraFocus.clear();clearScreenLight();++generation;++videoSession;videoCapture.cancel();starting?.abort();starting=undefined;release(preview,stream);preview=null;stream=null;},
 async capturePhoto(options?:{saveToGallery?:boolean}){const token=generation,video=preview;if(!video||!stream||video.readyState<2)throw Error('Camera is not ready.');
  const width=video.videoWidth,height=video.videoHeight;if(width<=0||height<=0||width*height>32_000_000)throw Error('Unsupported photo dimensions.');
  const canvas=drawCameraFrame(video,{zoom,mirror});
  const image=canvas.toDataURL('image/jpeg',0.85);if(!image.startsWith('data:image/jpeg;base64,'))throw Error('Photo encoding failed.');
  const photo={base64:image.slice('data:image/jpeg;base64,'.length),format:'jpeg',width,height};if(token!==generation)throw Error('Camera view changed.');
  if(!photo.base64||photo.base64.length>12_000_000)throw Error('Photo is too large to save in this app.');
  if(options?.saveToGallery===false)return photo;
  // Decimal time plus random suffix is sortable and keeps the existing receipt parser.
  const id=photoId();
  const row:Row={id,kind:'image',image:'data:image/jpeg;base64,'+photo.base64,width:photo.width,height:photo.height,date:Date.now(),revision:revision(),mutationRevision:revision(),favorite:false,trashed:false};
  await transaction<void>('readwrite',(store,set)=>{store.add(row);set(undefined);});
  return {...photo,path:'browser-photo:///'+id};
 },
 async switchCamera(options:{direction:'front'|'back'}){return browserCamera.startPreview({...options,resolution:{width:1280,height:720},mirror:options.direction==='front'});},
 async setZoom(input:{zoom:number}){if(!preview)throw Error('Start camera first.');if(!Number.isFinite(input.zoom)||input.zoom<1||input.zoom>8)throw Error('Digital zoom must be between 1× and 8×.');if(videoCapture.state().isRecording)throw Error('Stop recording before changing zoom.');cameraFocus.clear();zoom=input.zoom;preview.style.transform=`scale(${mirror?-zoom:zoom},${zoom})`;},
 flashAvailable(){return browserDevProfile||((stream?.getVideoTracks()[0]?.getCapabilities?.() as (MediaTrackCapabilities&{torch?:boolean})|undefined)?.torch===true);},
 lightingLabel(enabled:boolean){const torch=stream?.getVideoTracks()[0]?.getCapabilities?.() as (MediaTrackCapabilities&{torch?:boolean})|undefined;return `${browserDevProfile&&!torch?.torch?'Screen light':'Flash'} ${enabled?'on':'off'}`;},
 async setSettings(input:{settings:{flash:string}}){
  if(!['on','off'].includes(input.settings.flash))throw Error('Choose flash on or off.');
  const track=stream?.getVideoTracks()[0],token=generation,enabled=input.settings.flash==='on';if(!track)throw Error('Start camera first.');
  if(!(track.getCapabilities() as MediaTrackCapabilities&{torch?:boolean}).torch){if(browserDevProfile){setScreenLight(enabled);return;}if(enabled)throw Error('This camera does not expose a torch.');return;}clearScreenLight();
  await track.applyConstraints({advanced:[{torch:enabled} as MediaTrackConstraintSet&{torch:boolean}]});
  if(token!==generation)throw Error('Camera changed.');
  if((track.getSettings() as MediaTrackSettings&{torch?:boolean}).torch!==enabled){await track.applyConstraints({advanced:[{torch:false} as MediaTrackConstraintSet&{torch:boolean}]});throw Error('The camera could not confirm its torch setting.');}
 },
 async setFocusPoint(input:{x:number;y:number}){const frame=document.querySelector<HTMLElement>(finder),track=stream?.getVideoTracks()[0];if(!frame||!preview||!track)throw Error('Start camera first.');await cameraFocus.select(input,{frame,video:preview,track,zoom,mirror,development:browserDevProfile});},
 async startRecording(input:{audio?:boolean;maxDuration:number;maxFileSize:number}){if(!preview)throw Error('Start camera first.');++videoSession;videoSave=undefined;await videoCapture.start(preview,input,{zoom,mirror});},
 stopRecording(){
  if(videoSave)return videoSave;
  const token=generation,session=videoSession;
  videoSave=(async()=>{
   const clip=await videoCapture.stop(),id=mediaId();
   const path=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(clip.blob);});
   const row:Row={id:'v:'+id,kind:'video',path,duration:clip.duration,image:clip.image,width:clip.width,height:clip.height,date:Date.now(),revision:revision(),mutationRevision:revision(),favorite:false,trashed:false};
   await transaction<void>('readwrite',(store,set)=>{if(token!==generation||session!==videoSession)throw new DOMException('Video save cancelled.','AbortError');store.add(row);set(undefined);});
   return {path:'browser-video:///'+id,duration:clip.duration,width:clip.width,height:clip.height,fileSize:clip.blob.size};
  })();return videoSave;
 },
 async getRecordingState(){return videoCapture.state();},
};
