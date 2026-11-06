import {validateCameraCaptureResult,type CameraCaptureResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/camera-contract.ts';
import {reviewFileEmail} from './file-email-review';
import {connectionController} from '../runtime/connection-ui';
import type {MailAttachment} from '../runtime/inbox-attachment';
import {readMediaCopyIntent,admitMediaCopyIntent,acknowledgeMediaCopyIntent,mediaCopyIntentDocument,type MediaCopyIntent} from '../runtime/media-copy-intent';
import {createInlineModal} from '../runtime/inline-modal';
import {reviewContentQuestion} from '../browser/content-question';
import {createCaptureRevisions,captureUnchanged} from './context-selection';
import {createDeviceLibrary} from './photo-library-adapter';
import {openScanDocument,pickNativeScanImage} from './scan-document';
import {openVideoEditReview} from './video-edit-review';
import {openCameraImageImport} from './browser-image-import';
import {openScanReview} from './scan-review';
import {systemPickerActive} from './scan-pdf';
import {DailyApps} from '../daily';
import {browserCamera,browserLibrary,browserPhotoLibrary,mountBrowserCamera,importBrowserPhoto,saveBrowserMedia} from './browser-camera';
import { registerPlugin } from '../platform-plugins';
import { Capacitor } from '@capacitor/core';

type CameraCaptureAttempt={status:'succeeded'|'failed'|'unknown';summary:string;cameraResult?:CameraCaptureResult};
let requestedPhoto:((operationId:string,signal:AbortSignal,current:()=>void)=>Promise<CameraCaptureAttempt>)|undefined;
export async function captureAgentPhoto(operationId:string,signal:AbortSignal,current:()=>void):Promise<CameraCaptureAttempt>{
  if(!requestedPhoto)return {status:'failed',summary:'Camera capture is unavailable.'};
  return requestedPhoto(operationId,signal,current);
}
type Bag = Record<string, any>;
type VideoReceipt = { path: string; duration: number; width: number; height: number; fileSize: number };
type Photo = { base64: string; format: string; width: number; height: number; path?: string };
/** Android wire subset. Upstream's HTMLElement is a web-only argument: the
 * pinned Android implementation ignores it and mounts a full-parent PreviewView.
 * Do not serialize a DOM node or invent rectangle arguments. */
const nativeCamera = registerPlugin<{
  startPreview(options: { direction: 'front' | 'back'; resolution: { width: number; height: number }; mirror: boolean }): Promise<{ width: number; height: number; deviceId: string }>;
  stopPreview(): Promise<void>;
  capturePhoto(options: { format: 'jpeg'; quality: number; saveToGallery: boolean }): Promise<Photo>;
  startRecording(options: { audio: boolean; saveToGallery: boolean; quality: string; maxDuration: number; maxFileSize: number }): Promise<void>;
  stopRecording(): Promise<VideoReceipt>;
  getRecordingState(): Promise<{ isRecording: boolean; duration: number; fileSize: number }>;
  switchCamera(options: { direction: 'front' | 'back' }): Promise<unknown>;
  setZoom(options: { zoom: number }): Promise<void>;
  setSettings(options: { settings: { flash: 'off' | 'on' } }): Promise<void>;
  setFocusPoint(options: { x: number; y: number }): Promise<void>;
}>('ElizaCamera');
/** A read of the current grant; it never shows Android's permission dialog. */
const cameraAccess = registerPlugin<{ checkPermissions(): Promise<{ camera?: string }> }>('ElizaCamera');
// camera-resume:begin
/**
 * Whether a resume may restart a preview that stopped on a camera denial. Closing Android's own
 * permission dialog resumes the app too, so restarting on every resume asked for the camera again
 * straight after "Don't allow". Only an actual grant (made in Android settings) restarts the preview;
 * the read never prompts, and an unreadable state restarts nothing.
 */
export async function restartAfterResume(state: () => { denied?: string; phase: string; disposed: boolean }, check: () => Promise<{ camera?: string }>): Promise<boolean> {
  const stopped = () => { const now = state(); return now.denied === 'camera' && now.phase === 'error' && !now.disposed; };
  if (!stopped()) return false;
  let granted = false;
  try { granted = (await check()).camera === 'granted'; } catch { /* Unknown access never restarts. */ }
  return granted && stopped();
}
// camera-resume:end
type LibraryAccess = {scope:'full'|'partial'|'selected'|'denied';images:'full'|'selected'|'denied';videos:'full'|'selected'|'denied'};
type SavedPhoto = { name?:string;owned?:boolean;kind?: 'image' | 'video'; duration?: number; path?: string; id: string; image: string; width: number; height: number; date: number; revision: string; mutationRevision?: string; contentRevision?: string; trashed?: boolean; expiresAt?: number; favorite?: boolean };
const nativeLibrary = registerPlugin<{
  addListener(event:'libraryChanged',listener:()=>void):Promise<{remove():Promise<void>}>;
  libraryAccess():Promise<LibraryAccess>;
  /** The native MediaStore observer runs only while the Photos grid is open and visible. */
  watchLibrary(options:{active:boolean}):Promise<unknown>;
  requestLibraryAccess():Promise<LibraryAccess>;
  openLibrarySettings():Promise<void>;
  listPermitted(options:{before?:string;query?:string;kind?:'all'|'image'|'video';thumbnails?:boolean;filter?:'all'|'favorites'|'trash'}):Promise<{items:SavedPhoto[];next:string;access:LibraryAccess}>;
  beginEdit(options:{id:string;revision:string}):Promise<EditPreview>;
  previewEdit(options:{sessionId:string;rotation:number;crop:boolean;filter:string}):Promise<EditPreview>;
  saveEdit(options:{sessionId:string;rotation:number;crop:boolean;filter:string}):Promise<EditReceipt>;
  editResult(options:{operationId:string}):Promise<EditReceipt>;
  cancelEdit(options:{sessionId:string}):Promise<void>;
  beginVideoEdit(options:{id:string;revision:string}):Promise<{sessionId:string;operationId:string;duration:number;width:number;height:number}>;
  saveVideoEdit(options:{sessionId:string;start:number;end:number;rotation:number;crop:boolean}):Promise<EditReceipt>;
  cancelVideoEdit(options:{sessionId?:string}):Promise<void>;
  list(options: { before?: string; trashed?: boolean; album?: string }): Promise<{ items: SavedPhoto[]; next: string }>;
  read(options: { id: string; includeTrashed?: boolean }): Promise<SavedPhoto>;
  setTrashed(options: { id: string; revision: string; trashed: boolean }): Promise<SavedPhoto & {status:string}>;
  share(options: { id: string;revision?:string }): Promise<{ status: string; message?: string }>;
  setFavorite(options: {id:string;revision:string;favorite:boolean}): Promise<SavedPhoto>;
  deletePermittedTrash(options:{items:{id:string;revision:string}[]}):Promise<{status:string;outcomes:{id:string;status:string}[]}>;
  changeMany(options:{operation:'favorite'|'trash'|'restore';items:{id:string;revision:string}[]}):Promise<{status:string;outcomes:{id:string;status:string;item?:SavedPhoto}[]}>;
  shareMany(options:{items:{id:string;revision:string}[]}): Promise<{status:string;count:number;message?:string}>;
  albums(): Promise<{items:OwnedAlbum[]}>;
  changeAlbum(options:Record<string,unknown>): Promise<{status:string;id:string;revision:string}>;
  summary(): Promise<{favorites:number;videos:number;trash:number;canFavorite:boolean}>;
  prepareDeleteTrash(options?:{items:{id:string;revision:string}[]}): Promise<{confirmation:string;count:number}>;
  cancelDeleteTrash(options:{confirmation:string}): Promise<void>;
  deletePreparedTrash(options:{confirmation:string}): Promise<{status:string;deletedIds:string[];skippedIds:string[];failedIds:string[]}>;
  keepCapture(options:{dataBase64:string;operationId:string}): Promise<{status:string;id?:string;message?:string}>;
}>('AlphaPhotos');
const photoAttachments=registerPlugin<{readPhotoSelected(input:{id:string;revision:string}):Promise<MailAttachment&{size:number;sha256:string}>;cancelPhotoSelected():Promise<void>}>('AlphaMailAttachments');
const device=registerPlugin<{openSettings(options:{page:'privacy'}):Promise<{status:string}>}>('AlphaDevice');
type AccessKind='camera'|'microphone';
/** Only an explicit permission denial gets settings recovery. Every other
 * failure keeps the generic retry message; nothing is inferred from timing. */
export function mediaAccessDenied(error:unknown):AccessKind|undefined{
  const value=error as {code?:unknown;name?:unknown;message?:unknown}|null;
  const code=typeof value?.code==='string'?value.code:'',name=typeof value?.name==='string'?value.name:'',message=typeof value?.message==='string'?value.message:'';
  if(code==='MICROPHONE_DENIED'||/microphone permission denied/i.test(message))return 'microphone';
  if(code==='CAMERA_PERMISSION_DENIED'||name==='NotAllowedError'||name==='PermissionDeniedError'||/camera permission denied/i.test(message))return 'camera';
  return undefined;
}
/** Describe or extract text from a capture before anything reaches the
 * conversation draft. Pixels never leave the device; only reviewed text does. */
const CAPTURE_STOP=new Set(['of','at','the','in','on','from','with','and','my','a','an','me','show','find']);
export function captureSearchWords(query:unknown):string[]{return String(query||'').toLowerCase().replace(/'s\b/g,'').replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(word=>word&&!CAPTURE_STOP.has(word));}
/** Searchable facts are the capture's own metadata: kind, favorite, date words.
 * Nothing is inferred from pixels. Every query word must prefix-match. */
export function captureMatches(row:{kind?:string;favorite?:boolean;date:number;width?:number;height?:number},words:string[],now=new Date()):boolean{
  if(!words.length)return true;
  const date=new Date(row.date),day=new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime(),ago=Math.round((today-day)/86400000);
  const bag=['captured','camera','alpha',row.kind==='video'?'video':'photo',row.kind==='video'?'videos':'photos',row.kind==='video'?'clip':'picture',row.kind==='video'?'clips':'pictures',
    date.toLocaleDateString('en-US',{weekday:'long'}).toLowerCase(),date.toLocaleDateString('en-US',{month:'long'}).toLowerCase(),String(date.getFullYear()),String(date.getDate())];
  if(ago===0)bag.push('today');if(ago===1)bag.push('yesterday');if(ago>=0&&ago<7)bag.push('week');if(date.getDay()===0||date.getDay()===6)bag.push('weekend');
  if(row.favorite)bag.push('favorite','favorites','fav');
  if(row.width&&row.height)bag.push(row.width>row.height?'landscape':row.width<row.height?'portrait':'square');
  return words.every(word=>bag.some(term=>term.startsWith(word)));
}
let captureQuestion:((item?:{id:string})=>boolean)|undefined;
export function askAboutCapture(item?:{id:string}):boolean{return captureQuestion?.(item)??false;}
const browserMode=!Capacitor.isNativePlatform();
const camera:typeof nativeCamera=browserMode?browserCamera:nativeCamera;
// Check every implemented browser method against the native port contract.
browserPhotoLibrary satisfies Pick<typeof nativeLibrary,Exclude<keyof typeof browserPhotoLibrary,'saveVideoCopy'|'share'|'shareMany'>>;
const library=browserMode?browserLibrary as unknown as typeof nativeLibrary:nativeLibrary;
const libraryAvailable=()=>browserMode||Capacitor.isPluginAvailable('AlphaPhotos');
type EditPreview={sessionId:string;operationId:string;image:string;width:number;height:number;reduced:boolean;maxEdge:number;filter:string};
type EditReceipt={status:string;operationId:string;id?:string};
type OwnedAlbum = {id:string;name:string;revision:string;count:number;memberIds:string[]};
const finder = '[aria-label="Viewfinder. Tap to focus, hold to ask Alpha, swipe to change mode"]';

/** Install after native/selection adapters. Reload app-owned captures from
 * MediaStore; other personal images remain behind the Android photo picker. */
export function installPrototypeCameraAdapter(_Component: unknown, views: Record<string, Bag>): () => void {
  const module = views.camera;
  if (!module) return () => {};
  const render = module.render, leave = module.onLeave, cameraBack = module.back;
  const photosRender = views.photos?.render, photosBack = views.photos?.back, photosLeave = views.photos?.onLeave;
  const prototype=(_Component as any)?.prototype, originalApi=prototype?.api;
  const scanApi=typeof originalApi==='function'?function(this:Bag,key:string){
    const value=originalApi.call(this,key);
    if(key==='camera')value.saveScannedNote=async(text:string,id:string)=>{
      if(this.notesStorageFailed||this.notesPending||!this.notesStore)return false;
      const list=this.vget('notes').list||[];
      if(list.some((note:Bag)=>note.id===id))return false;
      return await this.vset('notes',{list:[{id,kind:'text',title:text.split('\n')[0].slice(0,100)||'Scanned text',body:text,when:'Now',pinned:false},...list]})===true;
    };
    return value;
  }:undefined;
  if(scanApi)prototype.api=scanApi;
  let closeQuestion:(()=>void)|undefined;
  /** Agent-context identity of the open capture: its id and a session-local revision, never the library's own. */
  const captureSelection=createCaptureRevisions();
  const deviceLibrary=createDeviceLibrary();
  let closeScan:(()=>void)|undefined;
  const cancelScan=()=>{closeScan?.();closeScan=undefined;};
  let api: Bag | undefined;
  let phase: 'off' | 'starting' | 'ready' | 'error' = 'off';
  let epoch = 0, controlBusy = false, capturing = false, direction: 'front' | 'back' = 'back';
  let flash = false, disposed = false, denied: AccessKind | undefined;
  let accessPanel: HTMLElement | undefined;
  let recording = false, recordingStarting = false, duration = 0;
  let finalizing: Promise<void> | undefined;
  let video: HTMLVideoElement | undefined, videoId = '';
  function closeVideo() { if (video) { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); } video = undefined; videoId = ''; }
  let stopping: Promise<void> = Promise.resolve();
  let captures: SavedPhoto[] = [];
  let photosApi: Bag | undefined, loaded = false, loading = false, next = '', libraryEpoch = 0;
  let libraryAccess:LibraryAccess|undefined,requestingLibraryAccess=false,libraryQuery='';
  const permittedLibrary=()=>!browserMode&&!!libraryAccess&&libraryAccess.scope!=='denied';
  let preview: SavedPhoto | undefined, reading = '', sharing = false;
  let photoReadEpoch=0;
  const retirePhotoRead=()=>{++photoReadEpoch;reading='';};
  let edit: (EditPreview & {source:string;rotation:number;crop:boolean;busy:boolean;uncertain?:boolean})|undefined,editEpoch=0;
  let editRecoveryChecked=false,copyRecovery:AbortController|undefined;
  let closeVideoEdit:(()=>void)|undefined,videoEditSource:string|undefined,nativeVideoSession:string|undefined,nativeVideoOpening:number|undefined;
  type PendingNativeVideoCopy={source:SavedPhoto;epoch:number;refresh:boolean;checkAgain:boolean;checking?:Promise<void>};
  let pendingNativeVideoCopy:PendingNativeVideoCopy|undefined;
  function cancelEdit(){copyRecovery?.abort();copyRecovery=undefined;const oldVideo=nativeVideoSession,opening=nativeVideoOpening;nativeVideoSession=undefined;nativeVideoOpening=undefined;closeVideoEdit?.();closeVideoEdit=undefined;videoEditSource=undefined;++editEpoch;const old=edit;edit=undefined;if(old)void library.cancelEdit({sessionId:old.sessionId}).catch(()=>{});if(oldVideo||opening!==undefined)void nativeLibrary.cancelVideoEdit(oldVideo?{sessionId:oldVideo}:{}).catch(()=>{});}
  async function beginEdit(row:SavedPhoto,owner:Bag){
    if(!row.mutationRevision||edit||mutating||nativeVideoOpening!==undefined||closeVideoEdit)return;
    cancelEdit();closeVideo();const token=editEpoch;let videoSessionId:string|undefined,copyIntentChecked=false;
    const current=()=>!disposed&&!document.hidden&&token===editEpoch&&owner.isActive()&&owner.get('photos').open===row.id;
    try{
      const pending=await readMediaCopyIntent();copyIntentChecked=true;if(!current())return;
      if(pending){owner.toast('Checking a previous saved-copy outcome…');void recoverEdit(owner);return;}
      if(row.kind==='video'){
        if(!browserMode)nativeVideoOpening=token;
        const session=browserMode?undefined:await nativeLibrary.beginVideoEdit({id:nativeId(row.id),revision:row.mutationRevision!});
        if(nativeVideoOpening===token)nativeVideoOpening=undefined;
        if(session){videoSessionId=session.sessionId;if(!current()){void nativeLibrary.cancelVideoEdit({sessionId:session.sessionId});return;}nativeVideoSession=session.sessionId;}
        const source=await library.read({id:nativeId(row.id)});if(!current()){if(session)void nativeLibrary.cancelVideoEdit({sessionId:session.sessionId});return;}
        if(!source.path||!source.duration||!browserMode&&source.mutationRevision!==row.mutationRevision)throw Error('Video changed or has no playable source.');
        const operationId=session?.operationId||crypto.randomUUID();videoEditSource=row.id;
        closeVideoEdit=openVideoEditReview({path:source.path,duration:session?.duration||source.duration,stream:!!session},async(parameters,signal)=>{
          const ticket:EditCompletion={token:operationId,epoch:token,source:row.id};let pendingCopy:PendingNativeVideoCopy|undefined;
          const abort=()=>{if(session)void nativeLibrary.cancelVideoEdit({sessionId:session.sessionId}).catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
          try{
            ticket.intent=await admitMediaCopyIntent(operationId,signal);automaticEditRecovery=operationId;
            if(signal.aborted||!current()){await acknowledgeMediaCopyIntent(ticket.intent);return false;}
            if(session)pendingNativeVideoCopy=pendingCopy={source:row,epoch:token,refresh:false,checkAgain:false};
            const receipt=session?await nativeLibrary.saveVideoEdit({sessionId:session.sessionId,...parameters}):await browserPhotoLibrary.saveVideoCopy({id:source.id,revision:row.mutationRevision!,operationId,edit:parameters},signal);
            await pendingCopy?.checking;
            await finishEdit(receipt,owner,ticket);return receipt.status==='saved';
          }catch{if(ticket.intent)await recoverEdit(owner,ticket);else if(current()){owner.set({nativeCopyRecovery:true});owner.toast('Copy request could not be retained. Check saved-copy recovery before another save.');}return false;}
          finally{signal.removeEventListener('abort',abort);if(pendingCopy&&pendingNativeVideoCopy===pendingCopy){pendingNativeVideoCopy=undefined;if(pendingCopy.refresh&&!disposed)invalidateLibrary(true);}}
        },()=>{if(session){if(nativeVideoSession===session.sessionId)nativeVideoSession=undefined;void nativeLibrary.cancelVideoEdit({sessionId:session.sessionId}).catch(()=>{});}if(editEpoch===token){++editEpoch;closeVideoEdit=undefined;videoEditSource=undefined;}});
        return;
      }
      const value=await library.beginEdit({id:nativeId(row.id),revision:row.mutationRevision});if(!current()){void library.cancelEdit({sessionId:value.sessionId});return;}
      edit={...value,source:row.id,rotation:0,crop:false,busy:false};owner.set({nativeEditRevision:Date.now()});
    }catch(error){if(videoSessionId){void nativeLibrary.cancelVideoEdit({sessionId:videoSessionId}).catch(()=>{});if(nativeVideoSession===videoSessionId)nativeVideoSession=undefined;}else if(nativeVideoOpening===token){nativeVideoOpening=undefined;void nativeLibrary.cancelVideoEdit({}).catch(()=>{});}if(current()){owner.set({nativeCopyRecovery:row.kind!=='video'||!copyIntentChecked});owner.toast(error instanceof Error?error.message:'Photo editor unavailable.');}}
  }
  async function transformEdit(owner:Bag,rotate:boolean,chosenFilter?:string){const current=edit;if(!current||current.busy||current.uncertain)return;current.busy=true;const rotation=rotate?(current.rotation+90)%360:current.rotation,crop=chosenFilter!==undefined?current.crop:rotate?current.crop:!current.crop,filter=chosenFilter??current.filter;owner.set({nativeEditRevision:Date.now()});
    try{const value=await library.previewEdit({sessionId:current.sessionId,rotation,crop,filter});if(edit===current)edit={...current,...value,rotation,crop,busy:false};}
    catch(error){if(edit===current){current.busy=false;owner.toast(error instanceof Error?error.message:'Preview unavailable. Original unchanged.');}}
    finally{if(owner.isActive())owner.set({nativeEditRevision:Date.now()});}
  }
  type EditCompletion={token:string;epoch:number;source:string|undefined;intent?:MediaCopyIntent};
  const completionCurrent=(ticket:EditCompletion,owner:Bag)=>!disposed&&!document.hidden&&owner.isActive()&&editEpoch===ticket.epoch&&owner.get('photos').open===ticket.source&&(!edit||edit.operationId===ticket.token);
  async function finishEdit(value:EditReceipt,owner:Bag,ticket:EditCompletion){
    // A late/duplicate outcome may only retire its own persisted operation.
    // It cannot consume a new save or cancel/navigate a newer editor/selection.
    if(value.operationId!==ticket.token||!ticket.intent)throw Error('Saved-copy receipt identity changed');
    const terminal=(value.status==='saved'&&!!value.id)||['failed','unchanged','not-started'].includes(value.status);if(!terminal)return false;
    await acknowledgeMediaCopyIntent(ticket.intent);
    // A library notification can arrive while acknowledgement yields too.
    const pendingCopy=pendingNativeVideoCopy;
    if(pendingCopy?.epoch===ticket.epoch&&pendingCopy.source.id===ticket.source)await pendingCopy.checking;
    const updateView=completionCurrent(ticket,owner);
    if(edit?.operationId===ticket.token)cancelEdit();
    if(!updateView)return true;owner.set({nativeCopyRecovery:false});
    if(videoEditSource&&videoEditSource===ticket.source&&closeVideoEdit){const close=closeVideoEdit;closeVideoEdit=undefined;close();}
    if(value.status==='saved'&&value.id){owner.toast('Saved a copy. Original unchanged.');void refresh();await openSaved('native-camera-'+value.id,owner);}
    else{owner.toast(value.status==='failed'?'Copy was not saved. Original unchanged.':'No copy was created. Original unchanged.');owner.set({nativeEditRevision:Date.now()});}return true;
  }
  let recoveringEdit=false,automaticEditRecovery='';
  async function recoverEdit(owner:Bag,original?:EditCompletion){
    if(recoveringEdit)return;recoveringEdit=true;
    const epoch=editEpoch,source=owner.get('photos').open;let ticket:EditCompletion|undefined;
    try{
      const intent=await readMediaCopyIntent();if(!intent||original&&JSON.stringify(original.intent)!==JSON.stringify(intent))return;
      ticket=original||{token:intent.token,epoch,source,intent};
      const value=await library.editResult({operationId:intent.token});if(!await finishEdit(value,owner,ticket)&&completionCurrent(ticket,owner)){owner.set({nativeCopyRecovery:true});owner.toast('Copy outcome is unresolved. No automatic retry; inspect Photos before trying another edit.');}
    }catch{if(!disposed&&owner.isActive()&&editEpoch===epoch){owner.set({nativeCopyRecovery:true});owner.toast('Copy outcome could not be checked. Use saved-copy recovery; no additional copy was created.');}}
    finally{recoveringEdit=false;}
  }
  async function saveEdit(owner:Bag){
    const current=edit;if(!current||current.busy)return;
    const ticket:EditCompletion={token:current.operationId,epoch:editEpoch,source:current.source};
    if(current.uncertain){void recoverEdit(owner);return;}current.busy=true;owner.set({nativeEditRevision:Date.now()});
    try{
      ticket.intent=await admitMediaCopyIntent(ticket.token);automaticEditRecovery=ticket.token;
      if(!completionCurrent(ticket,owner)){await acknowledgeMediaCopyIntent(ticket.intent);return;}
      const value=await library.saveEdit({sessionId:current.sessionId,rotation:current.rotation,crop:current.crop,filter:current.filter});
      if(!await finishEdit(value,owner,ticket)){if(edit===current)current.uncertain=true;await recoverEdit(owner,ticket);}
    }catch{if(edit===current)current.uncertain=true;if(ticket.intent)await recoverEdit(owner,ticket);else if(completionCurrent(ticket,owner)){owner.set({nativeCopyRecovery:true});owner.toast('Copy request could not be retained. Check saved-copy recovery before another save.');}}
    finally{if(edit===current){current.busy=false;if(completionCurrent(ticket,owner))owner.set({nativeEditRevision:Date.now()});}}
  }
  async function openCopyRecovery(owner:Bag){
    if(!browserMode||disposed||!owner.isActive())return;
    copyRecovery?.abort();const controller=copyRecovery=new AbortController(),token=editEpoch;
    try{const domain=await mediaCopyIntentDocument(),{openDomainRecovery}=await import('../browser/domain-recovery');if(controller.signal.aborted||disposed||!owner.isActive()||editEpoch!==token)return;
      openDomainRecovery({capture:signal=>domain.capture(signal),reset:async(expected,signal)=>{await domain.reset(expected,signal);editRecoveryChecked=false;automaticEditRecovery='';if(owner.isActive())owner.set({nativeCopyRecovery:false});}},'saved-copy request','Saved-copy recovery','Download the pending request before resetting. A photo or video copy may already exist. Inspect Photos before saving another copy. Reset clears only the saved request; it does not delete media, undo a saved copy or repeat an edit. Close older Alpha tabs before continuing.',controller.signal);
    }catch{if(!controller.signal.aborted&&owner.isActive())owner.toast('Saved-copy recovery is unavailable. The request remains retained.');}
  }
  let counts: {favorites:number;videos:number;trash:number;canFavorite:boolean} | undefined, countsBusy = false, countsError = false, countsEpoch = 0;
  let albumRows: SavedPhoto[] = [], albumKey = '', albumNext = '', albumBusy = false, albumEpoch = 0;
  let customAlbums: OwnedAlbum[] = [], albumsLoaded=false, albumsBusy=false, albumsEpoch=0;
  let manager: {media?:SavedPhoto;album?:OwnedAlbum;name:string;creating?:boolean;choosing?:boolean;confirmDelete?:boolean}|undefined;
  let albumTrigger:HTMLElement|null=null;
  const albumModal=createInlineModal(()=>{manager=undefined;photosApi?.set({sheet:null});},()=>albumTrigger);
  let selection: SavedPhoto[]|undefined;let holdTimer:number|undefined;let swallowedTap='';
  let selectionTab:'lib'|'alb'|undefined;
  const endHold=()=>{if(holdTimer!==undefined)clearTimeout(holdTimer);holdTimer=undefined;};
  function cancelPhotoSelection(owner:Bag){
    const tab=selectionTab;selection=undefined;selectionTab=undefined;swallowedTap='';endHold();
    owner.set({...(tab?{tab}:{}),nativeMultiSelection:Date.now()});
  }
  let prepared: {confirmation:string;count:number;items?:{id:string;revision:string}[]} | undefined;
  let trash: SavedPhoto[] = [], trashNext = '', trashLoaded = false, trashLoading = false, mutating = false, refreshAgain = false, trashRefreshAgain = false, trashEpoch = 0;
  const nativeId = (id: string) => id.replace(/^native-camera-/, '');
  const normalize = (photo: SavedPhoto): SavedPhoto => ({ ...photo, id: 'native-camera-' + photo.id });
  async function refresh(more = false) {
    if (disposed) return;
    if (loading) { refreshAgain = true; return; }
    if (!libraryAvailable()) {
      loaded = true;
      photosApi?.set({ nativeLibraryError: 'Saved photos are available in the Android app.' });
      return;
    }
    loading = true; const token = ++libraryEpoch;
    try {
      if(!browserMode)libraryAccess=await nativeLibrary.libraryAccess();
      const result = permittedLibrary()?await nativeLibrary.listPermitted({...(more?{before:next}:{}),query:libraryQuery}):await library.list(more ? { before: next } : {});
      if (disposed || token !== libraryEpoch) return;
      const rows = result.items.map(normalize);
      captures = more ? [...captures, ...rows.filter(row => !captures.some(old => old.id === row.id))] : rows;
      if(permittedLibrary())captures=captures.slice(-240);
      next = result.next; loaded = true; loading = false;
      photosApi?.set({ nativeLibraryError: '', nativeCaptureRevision: token });
      if (!more && photosApi) { void loadCounts(photosApi); void loadCustomAlbums(photosApi); }
      if (api?.isActive()) api.set({ nativeCaptureRevision: token });
    } catch { loaded = true; loading = false; if (!disposed) photosApi?.set({ nativeLibraryError: 'Saved photos could not be loaded. Tap to retry.' }); }
    finally { loading = false; if (refreshAgain && !disposed) { refreshAgain = false; queueMicrotask(() => { void refresh(); }); } }
  }
  function toggleSelection(row:SavedPhoto,owner:Bag){
    if(!selection||mutating||sharing)return;
    if(selection.some(item=>item.id===row.id))selection=selection.filter(item=>item.id!==row.id);
    else if(selection.length<20)selection=[...selection,row];else owner.toast('Select up to 20 items.');
    owner.set({nativePhotoSelection:null,nativeMultiSelection:Date.now()});
  }
  function thumbnailEvents(row:SavedPhoto,owner:Bag){return {
    selecting:!!selection,on:!!selection?.some(item=>item.id===row.id),selCss:selection?.some(item=>item.id===row.id)?'background:var(--acc);box-shadow:0 0 0 2px #ffffff':'background:rgba(0,0,0,.7);box-shadow:inset 0 0 0 2px #ffffff',
    tap:()=>{endHold();if(swallowedTap===row.id){swallowedTap='';return;}if(selection)toggleSelection(row,owner);else void openSaved(row.id,owner);},
    pd:()=>{endHold();if(selection||sharing||mutating)return;holdTimer=window.setTimeout(()=>{holdTimer=undefined;if(!owner.isActive()||disposed)return;selection=[row];selectionTab=owner.get('photos')?.tab==='alb'?'alb':'lib';swallowedTap=row.id;owner.set({open:null,nativePhotoSelection:null,nativeMultiSelection:Date.now()});},450);},pu:()=>{endHold();window.setTimeout(()=>{swallowedTap='';},0);},
  };}
  async function shareSelection(owner:Bag){
    if(!selection?.length||sharing||mutating)return;const chosen=selection,token=photoReadEpoch,current=()=>!disposed&&!document.hidden&&photoReadEpoch===token&&owner.isActive()&&selection===chosen&&chosen.every(sameCapture);sharing=true;owner.set({nativeMultiSelection:Date.now()});
    try{const items=chosen.map(row=>({id:nativeId(row.id),revision:row.mutationRevision||''})),result:Awaited<ReturnType<typeof nativeLibrary.shareMany>>=browserMode?await browserPhotoLibrary.shareMany({items},current):await nativeLibrary.shareMany({items});if(owner.isActive()&&result.message)owner.toast(result.message);}
    catch(error){if(owner.isActive()&&!(browserMode&&error instanceof DOMException&&error.name==='AbortError'))owner.toast(error instanceof Error?error.message:'Selection could not be shared. Reselect the items.');}
    finally{sharing=false;if(!disposed)owner.set({nativeMultiSelection:Date.now()});}
  }
  async function changeSelection(owner:Bag,operation:'favorite'|'trash'|'restore',undoItems?:SavedPhoto[]){
    if(mutating||sharing||disposed)return;
    const chosen=undoItems||selection;if(!chosen?.length)return;
    const selectionAtStart=selection;
    mutating=true;closeVideo();preview=undefined;retirePhotoRead();
    owner.set({open:null,nativePhotoSelection:null,nativeMultiSelection:Date.now()});
    try{
      const receipt=await library.changeMany({operation,items:chosen.map(row=>({id:nativeId(row.id),revision:row.mutationRevision||''}))});
      if(disposed)return;
      const verified=receipt.outcomes.filter(row=>row.item),changed=verified.filter(row=>row.status!=='unchanged');
      const successful=new Set(verified.map(row=>'native-camera-'+row.id));
      ++libraryEpoch;++trashEpoch;albumKey='';++albumEpoch;
      captures=captures.filter(row=>!successful.has(row.id));trash=trash.filter(row=>!successful.has(row.id));
      for(const row of verified){const before=chosen.find(item=>nativeId(item.id)===row.id);const item={...before,...normalize(row.item!)};if(item.trashed)trash.unshift(item);else captures.unshift(item);}
      if(owner.isActive()&&selection===selectionAtStart){
        selection=undoItems?undefined:chosen.filter(row=>!successful.has(row.id));if(!selection?.length)selection=undefined;
        owner.set({nativeMultiSelection:Date.now(),nativeCaptureRevision:Date.now()});
        const failed=receipt.outcomes.length-verified.length;
        const message=operation==='favorite'?`${verified.length} favorited`:operation==='trash'?`${verified.length} moved to Recently deleted`:`${verified.length} restored`;
        const undo=operation==='trash'?changed.map(row=>normalize(row.item!)):[];
        owner.toast(message+(failed?`; ${failed} not verified. Cancel selection and reselect to refresh.`:''),undo.length?{undo:()=>{void changeSelection(owner,'restore',undo);}}:undefined);
      }
    }catch{if(owner.isActive())owner.toast('Batch outcome could not be verified. Reopen Photos before retrying.');}
    finally{mutating=false;if(!disposed){void refresh();void loadTrash(owner);void loadCounts(owner);void loadCustomAlbums(owner);owner.set({nativeMultiSelection:Date.now()});}}
  }
  // Browser-owned album storage reports damaged saved data by failing to read.
  // Albums then offers the exact-byte recovery dialog; saved media is unaffected.
  let albumsRecovery=false;
  async function albumStoreNeedsRecovery(){
    if(!browserMode)return false;
    const {albumDocument}=await import('../browser/preference-documents');
    try{await albumDocument.read(()=>[]);return false;}catch{return true;}
  }
  async function loadCustomAlbums(owner: Bag) {
    if(disposed)return;const token=++albumsEpoch;albumsBusy=true;
    try{const result=await library.albums();if(!disposed&&token===albumsEpoch){customAlbums=result.items;albumsLoaded=true;albumsRecovery=false;owner.set({nativeAlbumsError:'',nativeAlbumsRevision:token});}}
    catch{const recovery=await albumStoreNeedsRecovery().catch(()=>false);if(!disposed&&token===albumsEpoch){albumsLoaded=true;albumsRecovery=recovery;owner.set({nativeAlbumsError:recovery?'Saved albums need recovery. Open Recover albums in Albums.':'Custom albums could not be loaded. Reopen album management to retry.',nativeAlbumsRevision:token});}}
    finally{if(token===albumsEpoch)albumsBusy=false;}
  }
  function openAlbumManager(owner:Bag,media?:SavedPhoto,album?:OwnedAlbum,trigger?:HTMLElement){
    albumTrigger=trigger||(document.activeElement instanceof HTMLElement?document.activeElement:null);
    manager={media,album,name:album?.name||''};owner.set({sheet:'owned-album'});void loadCustomAlbums(owner);
  }
  async function mutateAlbum(owner:Bag,operation:string,target?:OwnedAlbum){
    const current=manager;if(!current||mutating||disposed)return;
    const album=target||current.album,media=current.media;
    mutating=true;owner.set({nativePhotoMutation:Date.now()});
    try{
      await library.changeAlbum({operation,...(album?{id:album.id,revision:album.revision}:{}),...(media?{mediaId:nativeId(media.id),mediaRevision:media.mutationRevision}:{}),name:current.name});
      if(disposed)return;
      albumKey='';++albumEpoch;
      if(manager===current&&owner.isActive()&&owner.get('photos').sheet==='owned-album'){
        manager=undefined;
        owner.set({sheet:null,...(operation==='delete'?{album:null,open:null,nativePhotoSelection:null}:{}),nativeAlbumsError:''});
        if(operation==='delete'||operation==='remove')owner.toast(operation==='delete'?'Album deleted. Its media was kept.':'Removed from album. Its media was kept.');
      }
      await loadCustomAlbums(owner);
    }catch(error){if(!disposed){if(manager===current&&owner.isActive())owner.toast(error instanceof Error?error.message:'Album could not be saved.');void loadCustomAlbums(owner);}}
    finally{mutating=false;if(!disposed)owner.set({nativePhotoMutation:Date.now()});}
  }
  async function loadCounts(owner: Bag) {
    const token = ++countsEpoch; countsBusy = true;
    try { const result = await library.summary(); if (!disposed && token === countsEpoch) { counts = result; countsError = false; owner.set({ nativeAlbumCounts: token }); } }
    catch { countsError = true; }
    finally { if (token === countsEpoch) countsBusy = false; }
  }
  async function loadAlbum(key: string, owner: Bag, more = false) {
    if (disposed || (albumBusy && albumKey === key && more)) return;
    const token = ++albumEpoch; albumKey = key; albumBusy = true;
    if (!more) { albumRows = []; albumNext = ''; }
    try {
      const result = await library.list({ album: key.startsWith('custom:') ? key : key === 'fav' ? 'favorites' : 'videos', ...(more ? {before:albumNext} : {}) });
      if (disposed || token !== albumEpoch) return;
      const rows = result.items.map(normalize); albumRows = more ? [...albumRows,...rows.filter(row => !albumRows.some(old => old.id === row.id))] : rows;
      if(permittedLibrary())albumRows=albumRows.slice(-240);
      albumNext = result.next; owner.set({nativeAlbumError:'',nativeAlbumRevision:token});
      if (!more) void loadCounts(owner);
    } catch { if (!disposed && token === albumEpoch) owner.set({nativeAlbumError:'Album could not be loaded. Tap to retry.'}); }
    finally { if (token === albumEpoch) albumBusy = false; }
  }
  async function favorite(row: SavedPhoto, owner: Bag) {
    if (mutating || sharing || disposed || !row.mutationRevision) return;
    mutating = true; owner.set({nativePhotoMutation:Date.now()});
    try {
      const result = normalize(await library.setFavorite({id:nativeId(row.id),revision:row.mutationRevision,favorite:!row.favorite}));
      if (disposed) return;
      const updated = {...row,...result}; captures = captures.map(item=>item.id===row.id?updated:item);
      const stillSelected = owner.isActive() && owner.get('photos').open === row.id;
      if (stillSelected) preview = updated;
      owner.set({...(stillSelected ? {nativePhotoSelection:captureSelection(updated)} : {}),nativeCaptureRevision:Date.now()});
      albumKey='';++albumEpoch;void loadCounts(owner);
    } catch (error) { if (!disposed) owner.toast(error instanceof Error?error.message:'Favorite could not be changed.'); }
    finally { mutating = false; if(!disposed)owner.set({nativePhotoMutation:Date.now()}); }
  }
  function cancelPermanent(owner: Bag) {
    if(mutating)return;
    const old=prepared;prepared=undefined;owner.set({sheet:null});if(old?.confirmation)void library.cancelDeleteTrash({confirmation:old.confirmation}).catch(()=>{});
  }
  async function preparePermanent(owner: Bag,items?:SavedPhoto[]) {
    if(mutating||sharing||disposed)return;
    mutating=true;owner.set({nativePhotoMutation:Date.now()});
    try {
      const selected=items?.map(row=>({id:nativeId(row.id),revision:row.mutationRevision||''}));
      if(permittedLibrary()&&(!selected?.length||selected.length>20)){owner.toast('Select up to 20 deleted items first.');return;}
      const result=permittedLibrary()?{confirmation:'',count:selected!.length,items:selected}:await library.prepareDeleteTrash(selected?{items:selected}:undefined);
      if(disposed||!owner.isActive()||owner.get('photos').album!=='trash'){if(result.confirmation)void library.cancelDeleteTrash({confirmation:result.confirmation}).catch(()=>{});return;}
      if(result.count===0){void library.cancelDeleteTrash({confirmation:result.confirmation}).catch(()=>{});owner.toast('Recently deleted is empty.');return;}
      if(prepared?.confirmation)void library.cancelDeleteTrash({confirmation:prepared.confirmation}).catch(()=>{});
      prepared=result;owner.set({sheet:'empty',nativeTrashMutationStatus:''});
    } catch(error){if(!disposed)owner.toast(error instanceof Error?error.message:'Trash could not be prepared.');}
    finally{mutating=false;if(!disposed)owner.set({nativePhotoMutation:Date.now()});}
  }
  async function deletePermanent(owner: Bag) {
    if(mutating||disposed||!prepared)return;
    const snapshot=prepared;mutating=true;closeVideo();owner.set({nativePhotoMutation:Date.now()});
    try {
      let result:{deletedIds:string[];skippedIds:string[];failedIds:string[]};
      if(snapshot.items){const receipt=await nativeLibrary.deletePermittedTrash({items:snapshot.items});result={deletedIds:[],skippedIds:[],failedIds:[]};for(const item of snapshot.items){const outcome=receipt.outcomes.find(row=>row.id===item.id);if(outcome?.status==='deleted')result.deletedIds.push(item.id);else if(outcome?.status==='stale')result.skippedIds.push(item.id);else result.failedIds.push(item.id);}}
      else result=await library.deletePreparedTrash({confirmation:snapshot.confirmation});
      if(disposed)return;
      ++libraryEpoch;++trashEpoch;const deleted=new Set(result.deletedIds.map(id=>'native-camera-'+id));trash=trash.filter(row=>!deleted.has(row.id));captures=captures.filter(row=>!deleted.has(row.id));preview=undefined;
      const remaining=result.skippedIds.length+result.failedIds.length;
      selection=selection?.filter(row=>!deleted.has(row.id));if(!selection?.length)selection=undefined;owner.set({sheet:null,open:null,nativePhotoSelection:null,nativeTrashMutationStatus:remaining?`${result.deletedIds.length} deleted. ${remaining} changed or could not be deleted; review the remaining items.`:''});
      owner.toast(remaining?'Some items were not deleted.':`${result.deletedIds.length} ${result.deletedIds.length===1?'item':'items'} deleted forever`);
      void refresh();void loadTrash(owner);void loadCounts(owner);void loadCustomAlbums(owner);
    }catch(error){if(!disposed){owner.set({sheet:null,nativeTrashMutationStatus:'Deletion could not be completed. Review the remaining items.'});owner.toast(error instanceof Error?error.message:'Deletion failed.');void loadTrash(owner);}}
    finally{if(prepared===snapshot)prepared=undefined;mutating=false;if(!disposed)owner.set({nativePhotoMutation:Date.now()});}
  }
  async function loadTrash(owner: Bag, more = false) {
    if (disposed) return;
    if (trashLoading) { trashRefreshAgain = true; return; }
    trashLoading = true; const token = ++trashEpoch;
    try {
      const result = await library.list({ trashed: true, ...(more ? { before: trashNext } : {}) });
      if (disposed || token !== trashEpoch) return;
      const rows = result.items.map(normalize);
      trash = more ? [...trash, ...rows.filter(row => !trash.some(old => old.id === row.id))] : rows;
      if(permittedLibrary())trash=trash.slice(-240);
      trashNext = result.next; trashLoaded = true;
      owner.set({ nativeTrashError: '', nativeTrashRevision: Date.now() });
    } catch { if (!disposed) owner.set({ nativeTrashError: browserMode?'Browser trash could not be loaded. Tap to retry.':'Android trash could not be loaded. Android 11 or later is required.' }); }
    finally { trashLoading = false; if (trashRefreshAgain && !disposed) { trashRefreshAgain = false; queueMicrotask(() => { void loadTrash(owner); }); } }
  }
  async function changeTrash(row: SavedPhoto, desired: boolean, owner: Bag) {
    if (mutating || sharing || disposed) return;
    if (!row.mutationRevision) { owner.toast('Refresh Photos before changing this media.'); return; }
    mutating = true; closeVideo();
    try {
      const result = normalize(await library.setTrashed({ id: nativeId(row.id), revision: row.mutationRevision, trashed: desired }));
      if (disposed) return;
      ++libraryEpoch; ++trashEpoch; captures = captures.filter(item => item.id !== row.id); trash = trash.filter(item => item.id !== row.id);
      if (desired) trash.unshift({ ...row, ...result });
      else captures.unshift({ ...row, ...result });
      preview = undefined; retirePhotoRead();
      owner.set({ open: null, nativePhotoSelection: null, sheet: null, sel: null, nativeCaptureRevision: Date.now() });
      owner.toast(desired ? 'Moved to Recently deleted' : 'Restored', desired ? { undo: () => { void changeTrash({ ...row, ...result }, false, owner); } } : undefined);
      void refresh(); void loadTrash(owner); void loadCounts(owner); void loadCustomAlbums(owner); albumKey=''; ++albumEpoch;
    } catch (error) {
      if (!disposed) { owner.toast(error instanceof Error ? error.message : 'This media could not be changed.'); void refresh(); void loadTrash(owner); void loadCounts(owner); void loadCustomAlbums(owner); albumKey=''; ++albumEpoch; }
    } finally { mutating = false; }
  }
  async function openSaved(id: string, currentApi: Bag) {
    if (disposed || document.hidden || !currentApi.isActive() || reading === id) return;
    closeVideo();
    const readEpoch=++photoReadEpoch;
    reading = id;
    currentApi.set({ open: id, chrome: true, nativePhotoSelection: null });
    preview = undefined;
    try {
      const row = normalize(await library.read({ id: nativeId(id), includeTrashed: currentApi.get('photos').album === 'trash' }));
      if (disposed || document.hidden || !currentApi.isActive() || readEpoch!==photoReadEpoch || currentApi.get('photos').open !== id) return;
      preview = row;
      currentApi.set({ nativePhotoSelection: captureSelection(row) });
    } catch {
      if (!disposed && !document.hidden && currentApi.isActive() && readEpoch===photoReadEpoch && currentApi.get('photos').open === id) {
        currentApi.set({ open: null, nativePhotoSelection: null });
        currentApi.toast('This saved photo is no longer available.');
        void refresh();
      }
    } finally { if (readEpoch===photoReadEpoch && reading === id) reading = ''; }
  }
  const marked = new Set<HTMLElement>();
  const style = document.createElement('style');
  style.textContent = `
    [data-alpha-camera-clear]{background:transparent!important;background-color:transparent!important}
    [data-alpha-camera-screen]{background:linear-gradient(to bottom,#000 0px,#000 var(--alpha-camera-top),transparent var(--alpha-camera-top),transparent var(--alpha-camera-bottom),#000 var(--alpha-camera-bottom))!important}
    [data-alpha-camera-frame]{visibility:hidden!important}
    [data-alpha-camera-underlay]{display:none!important}
  `;
  document.head.append(style);
  function mask(enable: boolean) {
    if(browserMode){if(enable)mountBrowserCamera();return;}
    for (const el of marked) {
      el.removeAttribute('data-alpha-camera-clear'); el.removeAttribute('data-alpha-camera-screen'); el.removeAttribute('data-alpha-camera-frame'); el.removeAttribute('data-alpha-camera-underlay');
      el.style.removeProperty('--alpha-camera-top'); el.style.removeProperty('--alpha-camera-bottom');
    }
    marked.clear();
    if (!enable) return;
    const vf = document.querySelector<HTMLElement>(finder);
    const screen = vf?.closest<HTMLElement>('[data-screen]');
    if (!vf || !screen) return;
    for (let el: HTMLElement | null = vf; el; el = el.parentElement) { el.setAttribute('data-alpha-camera-clear', ''); marked.add(el); }
    // Home remains mounted as a lower-z sibling of the active app surface.
    // Transparency must reveal CameraX, not that still-painted DOM. Hide only
    // positioned screen siblings below the active camera branch; keep status,
    // chat/confirmation overlays and all camera controls above it untouched.
    let branch: HTMLElement = vf;
    while (branch.parentElement && branch.parentElement !== screen) branch = branch.parentElement;
    const cameraZ = Number(getComputedStyle(branch).zIndex);
    if (branch.parentElement === screen && Number.isFinite(cameraZ)) {
      for (const sibling of Array.from(screen.children)) {
        if (!(sibling instanceof HTMLElement) || sibling === branch) continue;
        const computed = getComputedStyle(sibling), z = Number(computed.zIndex);
        if (['absolute', 'fixed'].includes(computed.position) && computed.zIndex !== 'auto' && Number.isFinite(z) && z < cameraZ) {
          sibling.setAttribute('data-alpha-camera-underlay', ''); marked.add(sibling);
        }
      }
    }
    const rect = vf.getBoundingClientRect(), sr = screen.getBoundingClientRect();
    const scale = sr.width / (screen.offsetWidth || 412);
    screen.setAttribute('data-alpha-camera-screen', '');
    screen.style.setProperty('--alpha-camera-top', `${(rect.top - sr.top) / scale}px`);
    screen.style.setProperty('--alpha-camera-bottom', `${(rect.bottom - sr.top) / scale}px`);
    // The prototype's separate decorative device frame sits behind data-screen.
    // It must not cover the actual native preview through the transparent hole.
    const frame = screen.parentElement?.firstElementChild;
    if (frame instanceof HTMLElement && frame !== screen && !frame.contains(screen)) { frame.setAttribute('data-alpha-camera-frame', ''); marked.add(frame); }
  }
  let requestedCaptureActive=false;
  const cameraViewVisible = () => !disposed && !document.hidden && !!api?.isActive() && !!document.querySelector(finder);
  const active = () => cameraViewVisible() && (requestedCaptureActive || !['sheet', 'full'].includes(api?.S.chat));
  function hideAccess(){accessPanel?.remove();accessPanel=undefined;}
  function showAccess(kind:AccessKind|'unavailable'){
    denied=kind==='unavailable'?undefined:kind;hideAccess();
    const vf=document.querySelector<HTMLElement>(finder),screen=vf?.closest<HTMLElement>('[data-alpha-camera-root]')||vf?.closest<HTMLElement>('[data-alpha-layer]')||vf?.closest<HTMLElement>('[data-screen]');if(!screen)return;
    const panel=document.createElement('div');panel.setAttribute('role','alert');panel.setAttribute('aria-label',kind==='unavailable'?'Camera unavailable':kind==='camera'?'Camera access is off':'Microphone access is off');panel.dataset.alphaCameraAccess=kind;
    panel.style.cssText='position:absolute;left:16px;right:16px;top:38%;z-index:50;padding:16px;border-radius:20px;background:#1c1c1e;color:#fff;font:inherit;display:flex;flex-direction:column;gap:10px;text-align:center';
    const title=document.createElement('strong');title.textContent=kind==='unavailable'?'Camera unavailable':kind==='camera'?'Camera access is off':'Microphone access is off';
    const detail=document.createElement('span');detail.style.cssText='font-size:14px;line-height:1.4;color:rgba(255,255,255,.8)';
    detail.textContent=kind==='unavailable'?'The camera could not start. Close other apps using it, then try again.':kind==='camera'?(browserMode?'Allow camera access for this site in your browser settings, then try again.':'Allow camera access for Alpha in Android settings, then return here. The preview restarts when access is granted.'):(browserMode?'Allow microphone access for this site in your browser settings to record video with sound.':'Allow microphone access for Alpha in Android settings to record video with sound. Photos still work without it.');
    const actions=document.createElement('div');actions.style.cssText='display:flex;gap:8px;justify-content:center;flex-wrap:wrap';
    const action=(label:string,go:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText='min-height:44px;padding:0 16px;border-radius:22px;background:rgba(255,255,255,.16);color:#fff;font:inherit';b.onclick=go;actions.append(b);return b;};
    if(!browserMode&&kind!=='unavailable')action('Open Android settings',()=>{void device.openSettings({page:'privacy'}).catch(()=>message('Android settings could not open. Open Settings › Apps › Alpha › Permissions.'));});
    action('Try again',()=>{if(kind==='camera'||kind==='unavailable'){hideAccess();void start(true);}else{hideAccess();denied=undefined;message('');}});
    if(kind==='unavailable'){
      panel.style.top='calc(var(--alpha-camera-top,52px) + 20px)';panel.style.padding='12px';panel.style.flexDirection='row';panel.style.alignItems='center';panel.style.textAlign='left';
      title.style.cssText='display:block;font-size:16px;line-height:1.25';detail.style.cssText='display:block;font-size:12px;line-height:1.3;color:rgba(255,255,255,.8)';detail.textContent='Try again when the camera is free.';
      const copy=document.createElement('div');copy.style.cssText='flex:1;min-width:0';copy.append(title,detail);panel.append(copy,actions);
    }else panel.append(title,detail,actions);
    screen.append(panel);accessPanel=panel;
  }
  let noticeTimer:number|undefined,noticeGeneration=0;
  const message = (value:string,persistent=false) => {
    window.clearTimeout(noticeTimer);noticeTimer=undefined;const generation=++noticeGeneration;
    api?.set({said:value});
    if(value&&!persistent)noticeTimer=window.setTimeout(()=>{noticeTimer=undefined;if(!disposed&&generation===noticeGeneration&&api?.get('camera').said===value)api.set({said:''});},5000);
  };
  async function stop() {
    // A scan review that opened a system picker stays open while Android covers the WebView.
    closeQuestion?.();closeQuestion=undefined;if(!systemPickerActive())cancelScan(); ++epoch; phase = 'off'; controlBusy = false; mask(false); hideAccess();
    if (recording || finalizing) await finishVideo();
    stopping = stopping.then(async () => { try { if (browserMode || Capacitor.isPluginAvailable('ElizaCamera')) await camera.stopPreview(); } catch { /* startPreview resets native state before retrying. */ } });
    await stopping;
  }
  async function start(retry = false) {
    if (recordingStarting || finalizing || !active() || phase === 'starting' || phase === 'ready' || (phase === 'error' && !retry)) return;
    if (!browserMode && !Capacitor.isPluginAvailable('ElizaCamera')) { phase = 'error'; message('In-app camera is unavailable in this build.'); return; }
    const token = ++epoch; phase = 'starting'; message('Starting camera…');
    try {
      await stopping;
      if (token !== epoch || !active()) return;
      await camera.startPreview({ direction, resolution: { width: 1280, height: 720 }, mirror: direction === 'front' });
      if (token !== epoch || !active()) return;
      phase = 'ready';hideAccess();if(denied==='camera')denied=undefined;if(browserMode){flash=false;api?.set({zoom:1,flash:false});}mask(true); message('');
    } catch (error) {
      if (token !== epoch) return;
      phase = 'error'; mask(false);
      if(mediaAccessDenied(error)==='camera'){message('');showAccess('camera');}
      else {message('');showAccess('unavailable');}
    }
  }
  async function control(task: () => Promise<unknown>, completed: () => void) {
    if (phase !== 'ready' || controlBusy || capturing || recording || recordingStarting || finalizing) return;
    controlBusy = true; const token = epoch;
    try { await task(); if (token === epoch && active()) completed(); }
    catch { if (token === epoch) message('This camera does not support that control, or the operation was cancelled.'); }
    finally { if (token === epoch) controlBusy = false; }
  }
  async function finishVideo() {
    if (finalizing) return finalizing;
    recording = false; api?.set({ rec: false });
    finalizing = (async () => {
      message('Saving video…',true);
      try {
        const receipt = await camera.stopRecording();
        if (!/^(content:\/\/media\/|browser-video:\/\/\/)/.test(receipt.path) || receipt.duration <= 0 || receipt.fileSize <= 0) throw new Error('Incomplete recording');
        const id = receipt.path.split('/').pop();
        if (!id || !/^\d+$/.test(id)) throw new Error('Missing video identity');
        const item = normalize(await library.read({ id: 'v:' + id }));
        if (disposed) return;
        captures = [item, ...captures.filter(row => row.id !== item.id)]; loaded = false;
        api?.setView('photos', { nativeCaptureRevision: item.id });
        message('');
      } catch { if (!disposed) message('Video could not be finalized. No successful recording was confirmed.'); }
      finally { finalizing = undefined; }
    })();
    return finalizing;
  }
  async function record() {
    if (recording || finalizing) { await finishVideo(); return; }
    if (recordingStarting || capturing || controlBusy || phase !== 'ready') return;
    recordingStarting = true; const token = epoch; message('Starting video with microphone…',true);
    try {
      await camera.startRecording({ audio: true, saveToGallery: true, quality: 'medium', maxDuration: 300, maxFileSize: 104857600 });
      recording = true; duration = 0;
      if (token !== epoch || !active()) { await finishVideo(); return; }
      api?.set({ rec: true }); message('');
    } catch (error) { if (token === epoch && active()) { if(mediaAccessDenied(error)==='microphone'){message('');showAccess('microphone');} else message('Video could not start. Allow microphone access and tap the shutter to retry.'); } }
    finally { recordingStarting = false; schedule(); }
  }
  async function saveCameraPhoto(owner:Bag,showSaved:boolean):Promise<SavedPhoto>{
    // The pinned plugin scales width/height independently. Supplying only a
    // width distorts the saved image; retain sensor dimensions and let the
    // owned-media reader create bounded, aspect-preserving display previews.
    const photo = await camera.capturePhoto({ format: 'jpeg', quality: 85, saveToGallery: true });
    if (!photo.path || !(browserMode ? /^browser-photo:\/\/\/[1-9][0-9]{0,24}$/.test(photo.path) : /^content:\/\/media\/(?:external|external_primary)\/images\/media\/[1-9][0-9]{0,18}$/.test(photo.path)) || photo.format !== 'jpeg' || !photo.base64 || photo.width <= 0 || photo.height <= 0) throw new Error('Incomplete photo receipt');
    // A capture may finish after navigation: the native gallery write already
    // happened. Retain its real receipt, but never move the user back to Camera.
    const mediaId = photo.path.split('/').pop();
    if (!mediaId || !/^\d+$/.test(mediaId)) throw new Error('Missing MediaStore identity');
    const item: SavedPhoto = { id: 'native-camera-' + mediaId, image: 'data:image/jpeg;base64,' + photo.base64, width: photo.width, height: photo.height, date: Date.now(), revision: 'captured' };
    if (disposed) return item;
    captures = [item, ...captures.filter(row => row.id !== item.id)];
    loaded = false;
    if(showSaved)owner.setView('photos', { nativeCaptureRevision: item.id });
    else owner.set({nativeCaptureRevision:item.id});
    return item;
  }
  async function capture() {
    if (phase !== 'ready') { await start(true); return; }
    if (!api || capturing || controlBusy) return;
    if (api.get('camera').mode === 'video') { await record(); return; }
    const scanning=api.get('camera').mode==='scan';
    cancelScan();
    capturing = true; const token = epoch; const owner = api;
    if(scanning){
      // Scan mode keeps the frame in memory. Photos receives it only through Keep photo.
      message('Capturing page…');
      try{
        const photo=await camera.capturePhoto({format:'jpeg',quality:85,saveToGallery:false});
        if(photo.format!=='jpeg'||!photo.base64||photo.width<=0||photo.height<=0)throw new Error('Incomplete photo receipt');
        if(disposed||token!==epoch||!active())return;
        const bytes=Uint8Array.from(atob(photo.base64),char=>char.charCodeAt(0));
        closeScan=openScanReview(new Blob([bytes],{type:'image/jpeg'}),(text,id)=>owner.saveScannedNote?.(text,id)??Promise.resolve(false),draft=>{if(disposed||!active())return false;owner.open('calendar',{form:draft,open:null,month:null,day:draft.off},'hidden');return true;},'unsaved',(_image,signal)=>keepScan(photo,signal,owner));
        message('Page captured. It is not saved to Photos unless you keep it.');
      }catch{if(token===epoch&&active())message('Page could not be captured. Nothing was saved.');}
      finally{capturing=false;}
      return;
    }
    message('Saving photo…',true);
    try {
      await saveCameraPhoto(owner,true);
      if (token === epoch && active()) {
        message('');
      }
    } catch { if (token === epoch && active()) message('Photo could not be saved. No successful capture was confirmed.'); }
    finally { capturing = false; }
  }
  const takeRequestedPhoto=async(operationId:string,signal:AbortSignal,current:()=>void):Promise<CameraCaptureAttempt>=>{
    let dispatched=false,ownsCapture=false;
    try{
      signal.throwIfAborted();current();
      if(!cameraViewVisible()||!api||capturing||controlBusy||recording||recordingStarting||finalizing)return {status:'failed',summary:'Open Camera and finish the current capture before taking another photo.'};
      capturing=true;ownsCapture=true;requestedCaptureActive=true;
      if(phase!=='ready')await start(true);
      signal.throwIfAborted();current();
      if(!active()||phase!=='ready')return {status:'failed',summary:'Camera access or preview is unavailable. No photo was taken.'};
      const owner=api;dispatched=true;message('Taking photo…',true);
      const item=await saveCameraPhoto(owner,false);
      const cameraResult=validateCameraCaptureResult({version:1,kind:'camera_capture_photo',operationId,mediaId:nativeId(item.id),width:item.width,height:item.height,mime:'image/jpeg'},operationId);
      if(active())message('');
      return {status:'succeeded',summary:'Photo saved in Photos.',cameraResult};
    }catch{return {status:dispatched?'unknown':'failed',summary:dispatched?'The photo outcome is unconfirmed. Check Photos before taking another.':'The Camera request changed. No photo was taken.'};}
    finally{if(ownsCapture){capturing=false;requestedCaptureActive=false;schedule();}}
  };
  requestedPhoto=takeRequestedPhoto;
  async function keepScan(photo:Photo,signal:AbortSignal,owner:Bag):Promise<string>{
    if(browserMode){
      const row=await importBrowserPhoto({original:new File([],'scan.jpg',{type:'image/jpeg'}),image:'data:image/jpeg;base64,'+photo.base64,width:photo.width,height:photo.height},signal);
      captures=[normalize(row),...captures.filter(item=>nativeId(item.id)!==row.id)];loaded=false;owner.setView('photos',{nativeCaptureRevision:row.id});
      return 'Photo kept in Photos in this browser.';
    }
    const result=await library.keepCapture({dataBase64:photo.base64,operationId:crypto.randomUUID()});signal.throwIfAborted();
    if(result.status!=='saved'||!result.id)throw Error(result.message||'Photo was not kept.');
    loaded=false;owner.setView('photos',{nativeCaptureRevision:'native-camera-'+result.id});return 'Photo kept in Android Photos.';
  }
  /** Android: the system picker returns one image straight into scan review
   * (source 'selected'); the grant is released and nothing is copied to Photos. */
  async function chooseNativeImage(owner:Bag){
    try{
      const image=await pickNativeScanImage();
      // The picker covered the page, so the preview restarted: check the view, not the camera epoch.
      if(!image||disposed||!owner.isActive())return;
      closeScan=openScanReview(image,(text,id)=>owner.saveScannedNote?.(text,id)??Promise.resolve(false),draft=>{if(disposed||!active())return false;owner.open('calendar',{form:draft,open:null,month:null,day:draft.off},'hidden');return true;},'selected');
    }catch(error){if(!disposed&&owner.isActive())message(error instanceof Error&&error.message?error.message:'The selected image could not be read.');}
  }
  function chooseImage(){
    if(!api||!active()||recording||recordingStarting||finalizing||capturing)return;
    if(!browserMode){cancelScan();void chooseNativeImage(api);return;}
    cancelScan();const owner=api,token=epoch;
    closeScan=openCameraImageImport(async(image,signal)=>{
      if(token!==epoch||!active())throw Error('Camera closed.');const row=await importBrowserPhoto(image,signal);loaded=false;
      if(token===epoch&&active()){captures=[normalize(row),...captures.filter(item=>nativeId(item.id)!==row.id)];owner.setView('photos',{nativeCaptureRevision:row.id});message('');}
    },image=>{
      if(token!==epoch||!active())return;
      closeScan=openScanReview(image,(text,id)=>owner.saveScannedNote?.(text,id)??Promise.resolve(false),draft=>{if(disposed||!active())return false;owner.open('calendar',{form:draft,open:null,month:null,day:draft.off},'hidden');return true;},'selected');
    });
  }
  function askCameraFrame(owner:Bag):boolean{
    if(recording||recordingStarting||finalizing||capturing||phase!=='ready')return false;
    closeQuestion?.();const token=epoch;
    closeQuestion=reviewContentQuestion({name:'Camera frame',text:'',current:()=>token===epoch&&active(),compose:draft=>owner.composeContentQuestion(draft),image:async signal=>{const photo=await camera.capturePhoto({format:'jpeg',quality:85,saveToGallery:false});signal.throwIfAborted();if(!photo.base64)throw Error('Camera frame unavailable.');return new Blob([Uint8Array.from(atob(photo.base64),char=>char.charCodeAt(0))],{type:'image/jpeg'});}});
    return true;
  }
  /** The reviewed item is still the listed one at the revision the review started with:
   * an edited, replaced or removed capture ends its review instead of continuing under the same id. */
  function sameCapture(selected:SavedPhoto):boolean{
    const live=[preview,...captures,...albumRows].find(row=>row?.id===selected.id);
    return !!live&&!live.trashed===!selected.trashed&&(selected.mutationRevision&&live.mutationRevision?live.mutationRevision===selected.mutationRevision:live.revision===selected.revision)&&(selected.contentRevision===undefined||live.contentRevision===selected.contentRevision);
  }
  function emailPhoto(selected:SavedPhoto,owner:Bag){
    closeQuestion?.();const session=connectionController.getCloudClient()?.sessionId;
    const current=()=>!disposed&&!document.hidden&&owner.isActive()&&owner.get('photos').open===selected.id&&sameCapture(selected)&&connectionController.getCloudClient()?.sessionId===session;
    closeQuestion=reviewFileEmail({
      sourceNote:'Uses the provider-readable source file, not the preview. Android privacy redactions are retained.',
      read:()=>photoAttachments.readPhotoSelected({id:nativeId(selected.id),revision:selected.mutationRevision!}),current,
      target:()=>views.inbox.fileEmailTarget(),insert:(file,token)=>current()&&views.inbox.attachReviewedFile(file,token),
      inserted:()=>owner.open('inbox'),
    });
  }
  function askCapture(selected:SavedPhoto,owner:Bag):boolean{
    closeQuestion?.();
    const live=()=>!disposed&&!document.hidden&&owner.isActive()&&owner.get('photos').open===selected.id&&sameCapture(selected);
    // The library row is read again at send time; a photo another app rewrote in place differs in contentRevision.
    const unchanged=(row:SavedPhoto)=>captureUnchanged(selected,row);
    closeQuestion=reviewContentQuestion({name:selected.kind==='video'?'Video preview frame':'Selected photo',text:'',current:live,compose:draft=>{void (async()=>{
      // The library is read again before the draft is placed: an item trashed, edited or removed
      // since the review started (here or by another app) adds nothing to the conversation.
      let row:SavedPhoto|undefined;
      try{row=await library.read({id:nativeId(selected.id)});}catch{/* removed or unreadable: handled as changed below */}
      if(disposed||!owner.isActive())return;
      if(owner.get('photos').open!==selected.id||document.hidden){owner.toast('The photo view changed. Nothing was added to your conversation.');return;}
      if(row&&unchanged(row)&&live()){owner.composeContentQuestion(draft);return;}
      owner.toast('This photo changed or is no longer available. Nothing was added to your conversation.');
      // Leave the stale viewer so the changed item is neither shown nor shared as it was.
      closeVideo();if(preview?.id===selected.id)preview=undefined;retirePhotoRead();owner.set({open:null,nativePhotoSelection:null,sheet:null,nativeCaptureRevision:Date.now()});
      void refresh();void loadTrash(owner);void loadCounts(owner);
    })();},image:async signal=>{const row=await library.read({id:nativeId(selected.id)});signal.throwIfAborted();if(!unchanged(row))throw Error('Photo changed.');if(!/^(blob:|data:image\/)/.test(row.image))throw Error('Choose a local image.');return (await fetch(row.image,{signal})).blob();}});
    return true;
  }
  captureQuestion=item=>{
    if(disposed)return false;
    if(!item){const owner=api;return !!owner?.isActive()&&askCameraFrame(owner);}
    const owner=photosApi;if(!owner?.isActive())return false;
    const selected=[preview,...captures,...albumRows].find(row=>row?.id===item.id);
    return !!selected&&owner.get('photos').open===selected.id&&askCapture(selected,owner);
  };
  module.render = (st: Bag, currentApi: Bag) => {
    api = currentApi;
    queueMicrotask(schedule);
    if (!loaded && !loading) queueMicrotask(() => { void refresh(); });
    const data = render(st, currentApi);
    data.bg = 'transparent'; data.vfBg = phase === 'ready' ? 'transparent' : '#000000';
    data.drift = ''; data.zoomCss = ''; data.scanFound = false; data.scanning = false; data.rec = recording; data.recTime = `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}`; data.flOp = 0;
    data.shutterHint=st.mode==='video'?'Stops and saves when you leave. Maximum 5 minutes or 100 MB.':'';
    if(st.mode==='scan')data.shutterLabel='Scan text';
    data.shutter = () => { void capture(); };
    data.importAvailable=(browserMode||Capacitor.isPluginAvailable('DailyApps'))&&!recording&&!recordingStarting&&!finalizing;data.importImage=chooseImage;data.scanDocument=()=>{cancelScan();closeScan=openScanDocument();};
    data.flip = () => { const next = direction === 'back' ? 'front' : 'back'; void control(() => camera.switchCamera({ direction: next }), () => { direction = next; flash = false; currentApi.set({ front: next === 'front', flash: false, ...(browserMode?{zoom:1}:{}) }); }); };
    data.flashAvailable=!browserMode||browserCamera.flashAvailable();if(browserMode)data.flashLabel=browserCamera.lightingLabel(flash);
    data.toggleFlash = () => { const next = !flash; void control(() => camera.setSettings({ settings: { flash: next ? 'on' : 'off' } }), () => { flash = next; currentApi.set({ flash: next }); }); };
    data.zooms = (data.zooms || []).map((z: Bag, i: number) => ({ ...z, pick: () => { const ratio = parseFloat(z.label); void control(() => camera.setZoom({ zoom: ratio }), () => currentApi.set({ zoom: i })); } }));
    data.vfDown = () => {};
    data.vfUp = (event: PointerEvent) => { const bounds=browserMode?document.querySelector(finder)?.getBoundingClientRect():undefined;void control(() => camera.setFocusPoint({ x: Math.max(0, Math.min(1, (event.clientX-(bounds?.left??0)) / (bounds?.width||window.innerWidth))), y: Math.max(0, Math.min(1, (event.clientY-(bounds?.top??0)) / (bounds?.height||window.innerHeight))) }), () => message('')); };
    data.vfLeave = () => {};
    data.modes = (data.modes || []).map((m: Bag) => ({ ...m, pick: () => { if (recording || recordingStarting || finalizing || capturing) return; const mode = m.label.toLowerCase(); if (['photo','video','scan'].includes(mode)){cancelScan();currentApi.set({ mode, rec: false, found: false });if(mode==='scan')message('Hold text steady, then tap Scan text. English recognition runs locally.');} } }));
    data.ask = () => { if(!askCameraFrame(currentApi))message(phase==='ready'?'Finish the current capture, then ask again.':'Start the camera to ask about what it sees.'); };
    data.lastLabel=captures[0]?.kind==='video'?'Open last video':'Open last photo';
    if (captures[0]) {
      data.hasLast = true; data.noLast = false; data.lastBg = `url("${captures[0].image}") center / cover no-repeat`; data.lastTf = ''; data.lastFlt = '';
      data.openLast = () => { currentApi.open('photos', {tab:'lib',album:null,open:captures[0].id,chrome:true,nativePhotoSelection:null}); };
    } else { data.hasLast = false; data.noLast = true; data.openLast = () => message('Take a photo first.'); }
    return data;
  };
  module.back = () => { if (recording || recordingStarting || finalizing) { void stop(); return true; } return false; };
  module.onLeave = () => { void stop(); };
  if (photosRender) views.photos.render = (st: Bag, currentApi: Bag) => {
    photosApi = currentApi;
    const query=!browserMode&&st.searching?String(st.q||'').slice(0,128):'';
    if(query!==libraryQuery){libraryQuery=query;loaded=false;++libraryEpoch;captures=[];next='';if(loading)refreshAgain=true;}
    // Read canonical intent once per Photos entry, without replaying a save.
    if(currentApi.isActive()&&!edit&&!editRecoveryChecked){
      editRecoveryChecked=true;const token=editEpoch;
      queueMicrotask(()=>{void readMediaCopyIntent().then(pending=>{if(!disposed&&currentApi.isActive()&&editEpoch===token&&pending&&automaticEditRecovery!==pending.token){automaticEditRecovery=pending.token;void recoverEdit(currentApi);}}).catch(()=>{if(!disposed&&currentApi.isActive()&&editEpoch===token){currentApi.set({nativeCopyRecovery:true});currentApi.toast('Saved-copy request needs recovery. No edit was repeated.');}});});
    }
    if (!loaded && !loading) queueMicrotask(() => { void refresh(); });
    const data = photosRender(st, currentApi);data.normalSelecting=true;if(data.v)data.v.notDeleted=true;
    data.libraryAccessControl=!browserMode&&libraryAccess?.scope==='denied'&&!st.open&&!st.album&&!selection;
    data.libraryAccessLabel=libraryAccess?.scope==='full'?'All permitted photos and videos':libraryAccess?.scope==='selected'?'Selected photos and videos':libraryAccess?.scope==='partial'?`Photos: ${libraryAccess.images}; videos: ${libraryAccess.videos}`:'Only photos and videos saved by Alpha';
    data.libraryAccessBusy=requestingLibraryAccess;
    data.libraryAccessNeedsChoice=libraryAccess?.scope!=='full';data.libraryAccessButton='Choose photo access';
    data.libraryAccessChoose=async()=>{if(requestingLibraryAccess)return;requestingLibraryAccess=true;currentApi.set({nativeLibraryAccessRevision:Date.now()});try{libraryAccess=await nativeLibrary.requestLibraryAccess();retirePhotoRead();captures=[];preview=undefined;next='';loaded=false;cancelEdit();closeVideo();currentApi.set({open:null,nativePhotoSelection:null});await refresh();}catch{currentApi.toast('Photo access could not open. You can review it in Android settings.');}finally{requestingLibraryAccess=false;currentApi.set({nativeLibraryAccessRevision:Date.now()});}};
    data.searchPlaceholder=permittedLibrary()?'Filename in permitted library':'People, places, days';
    data.copyRecovery=browserMode&&!!st.nativeCopyRecovery;data.openCopyRecovery=()=>void openCopyRecovery(currentApi);
    if (!trashLoaded && !trashLoading && !st.nativeTrashError && libraryAvailable()) queueMicrotask(() => { void loadTrash(currentApi); });
    if (!counts && !countsBusy && !countsError && libraryAvailable()) queueMicrotask(() => { void loadCounts(currentApi); });
    data.trashN = counts ? String(counts.trash) : trashLoaded ? String(trash.length) + (trashNext ? '+' : '') : '…';
    data.tiles = [['fav','Favorites',counts?.favorites],['video','Videos',counts?.videos]].map(([key,name,count])=>({name,count:count??'…',bg:(captures.find(row=>key==='fav'?row.favorite:row.kind==='video')?.image ? `url("${captures.find(row=>key==='fav'?row.favorite:row.kind==='video')?.image}") center / cover no-repeat` : 'var(--s2)'),tf:'',flt:'',open:()=>{currentApi.set({album:key,open:null,nativePhotoSelection:null});closeVideo();void loadAlbum(String(key),currentApi);}}));
    if(!albumsLoaded&&!albumsBusy)queueMicrotask(()=>{void loadCustomAlbums(currentApi);});
    data.tiles.push(...customAlbums.map(album=>({name:album.name,count:album.count,bg:'var(--s2)',tf:'',flt:'',open:()=>{currentApi.set({album:'custom:'+album.id,open:null,nativePhotoSelection:null});closeVideo();void loadAlbum('custom:'+album.id,currentApi);void loadCustomAlbums(currentApi);}})));
    const deviceTile=deviceLibrary.tile(currentApi);if(deviceTile)data.tiles.push(deviceTile);
    if(albumsRecovery)data.tiles.push({name:'Recover albums',count:'Original data retained',bg:'var(--s2)',tf:'',flt:'',open:()=>{void import('../browser/preference-recovery').then(m=>m.openAlbumRecovery()).catch(()=>currentApi.toast('Album recovery could not be opened. Try again.'));}});
    data.albumBackLabel='Back to albums';data.selectionBusy=mutating||sharing;
    data.albumManager=st.sheet==='owned-album'&&!!manager;
    if(manager){const selectedManager=manager;data.am={modalRef:albumModal.ref,title:manager.confirmDelete?'Delete album?':manager.creating?'New album':manager.album?'Manage album':manager.choosing?'Add to album':manager.media?.kind==='video'?'Video info':'Photo info',name:manager.name,onName:(event:Event)=>{if(manager){manager.name=(event.target as HTMLInputElement).value;currentApi.set({nativeAlbumDraft:Date.now()});}},
      managing:!!manager.album,naming:!!manager.creating||!!manager.album&&!manager.confirmDelete,info:!!manager.media&&!manager.creating&&!manager.choosing,description:manager.media?`${manager.media.width} × ${manager.media.height} · ${manager.media.kind==='video'?'Video':'Photo'}${manager.media.kind==='video'&&Number.isFinite(manager.media.duration)&&manager.media.duration!>0?' · '+manager.media.duration!.toFixed(1)+'s':''} · ${browserMode?'saved in this app':'on this device'}`:'',choose:()=>{if(manager){manager.choosing=true;currentApi.set({nativeAlbumDraft:Date.now()});}},choosing:!!manager.media&&!!manager.choosing&&!manager.creating,confirming:!!manager.confirmDelete,error:st.nativeAlbumsError||'',busy:mutating,
      items:customAlbums.map(album=>({name:album.name,label:(album.memberIds.includes(nativeId(manager?.media?.id||''))?'Remove from ':'Add to ')+album.name,go:()=>{void mutateAlbum(currentApi,album.memberIds.includes(nativeId(selectedManager.media?.id||''))?'remove':'add',album);}})),
      create:()=>{if(manager){manager.creating=true;manager.name='';currentApi.set({nativeAlbumDraft:Date.now()});}},save:()=>{void mutateAlbum(currentApi,selectedManager.creating?'create':'rename');},askDelete:()=>{if(manager){manager.confirmDelete=true;currentApi.set({nativeAlbumDraft:Date.now()});}},delete:()=>{void mutateAlbum(currentApi,'delete');},close:()=>{manager=undefined;currentApi.set({sheet:null});}};}
    data.selStart=()=>{if(mutating||sharing)return;selection=[];selectionTab=st.tab==='alb'?'alb':'lib';swallowedTap='';endHold();currentApi.set({tab:'lib',sel:null,open:null,nativePhotoSelection:null,nativeMultiSelection:Date.now()});};
    if(selection){data.hdr=false;data.selecting=true;data.selN=selection.length?String(selection.length):'Select';data.selNone=!selection.length;data.selectionDisabled=!selection.length||mutating||sharing;data.selDim=!selection.length||sharing||mutating?'opacity:.35;pointer-events:none':'';data.selCancel=()=>cancelPhotoSelection(currentApi);data.trashSelecting=st.album==='trash';data.normalSelecting=st.album!=='trash';data.trashCanDelete=true;data.selRecover=()=>{void changeSelection(currentApi,'restore');};data.selDeleteForever=()=>{if(selection?.length)void preparePermanent(currentApi,selection);};data.selShare=()=>{void shareSelection(currentApi);};data.selSaveLocally=browserMode?()=>{const chosen=selection||[],token=photoReadEpoch;return saveBrowserMedia({items:chosen.map(row=>({id:nativeId(row.id),revision:row.mutationRevision||''}))},()=>!disposed&&!document.hidden&&photoReadEpoch===token&&currentApi.isActive()&&selection===chosen&&chosen.every(sameCapture));}:undefined;data.selFav=()=>{void changeSelection(currentApi,'favorite');};data.selDel=()=>{void changeSelection(currentApi,'trash');};}
    data.mutationBusy = mutating;
    data.emptyOpen = st.sheet==='empty' && !!prepared;
    data.trashCount = prepared ? `${prepared.count} ${prepared.items?'selected':'app-owned'} ${prepared.count===1?'item':'items'} · This cannot be undone.` : '';
    const priorCloseSheet = data.closeSheet; data.closeSheet=()=>{if(st.sheet==='empty')cancelPermanent(currentApi);else if(st.sheet==='owned-album'){manager=undefined;currentApi.set({sheet:null});}else priorCloseSheet?.();};
    data.openTrash = () => { currentApi.set({ album: 'trash', open: null, nativePhotoSelection: null }); closeVideo(); void loadTrash(currentApi); };
    data.emptyNow = () => { void deletePermanent(currentApi); };
    data.trashAsk = () => { void preparePermanent(currentApi); };
    if (st.album === 'trash') {
      data.album = true; data.viewing = false; data.viewEmpty = false;
      data.albumBackLabel=selection?'Cancel selection':'Back to albums';
      data.alb = {notSelecting:!selection,select:()=>{if(mutating||sharing)return;selection=[];selectionTab=st.tab==='alb'?'alb':'lib';currentApi.set({open:null,nativePhotoSelection:null,nativeMultiSelection:Date.now()});},selecting:!!selection,selectAllLabel:trash.length>20?'Select first 20':'Select shown',selectAll:()=>{if(mutating||sharing)return;if(!selection)selectionTab=st.tab==='alb'?'alb':'lib';selection=trash.slice(0,20);if(trash.length>20)currentApi.toast('Select up to 20 items at a time.');currentApi.set({nativeMultiSelection:Date.now()});},title: selection?`${selection.length} selected`:'Recently deleted', isTrash: true, canEmpty: !permittedLibrary()&&!selection&&trash.length>0, notTrash: false, count: selection?'':data.trashN, empty: !trash.length,
        close: () => {if(mutating||sharing)return;if(selection)cancelPhotoSelection(currentApi);else currentApi.set({album:null});}, emptyTrash: () => { void preparePermanent(currentApi); },
        status: st.nativeTrashError || st.nativeTrashMutationStatus || (trashLoading ? 'Loading…' : permittedLibrary()?'Open to preview, or select items to recover or delete.':''), more: !!trashNext || !!st.nativeTrashError,
        moreLabel: st.nativeTrashError ? 'Retry' : trashLoading ? 'Loading…' : 'Load more', loadMore: () => { void loadTrash(currentApi, !st.nativeTrashError); },
        items: trash.map(row => ({ nativeMediaId: row.id, bg: row.image ? `url("${row.image}") center / cover no-repeat` : 'var(--s2)', tf: '', flt: '', vid: row.kind === 'video', dur: '', selecting:!!selection,on:!!selection?.some(item=>item.id===row.id),selCss:selection?.some(item=>item.id===row.id)?'background:var(--acc)':'background:#0006;box-shadow:inset 0 0 0 2px #fff',dim:mutating?'opacity:.35;pointer-events:none':'',
          alt: `Deleted ${row.kind === 'video' ? 'video' : 'photo'} ${new Date(row.date).toLocaleTimeString()}${row.expiresAt ? '; Android expiration ' + new Date(row.expiresAt).toLocaleDateString() : ''}`,
          tap:()=>{if(selection)toggleSelection(row,currentApi);else void openSaved(row.id,currentApi);},pd:()=>{},pu:()=>{} })) };
    }
    if (st.album === 'device') { data.album = true; data.viewing = false; data.viewEmpty = false; data.alb = deviceLibrary.album(st, currentApi); }
    if (st.album === 'fav' || st.album === 'video' || st.album?.startsWith('custom:')) {
      if(albumKey !== st.album){albumRows=[];albumNext='';queueMicrotask(()=>{void loadAlbum(st.album,currentApi);});}
      data.album=true;data.alb={title:st.album.startsWith('custom:')?(customAlbums.find(row=>'custom:'+row.id===st.album)?.name||'Album'):st.album==='fav'?'Favorites':'Videos',isCustom:st.album.startsWith('custom:'),manage:(event:Event)=>{const album=customAlbums.find(row=>'custom:'+row.id===st.album);if(album)openAlbumManager(currentApi,undefined,album,event.currentTarget as HTMLElement);},isTrash:false,notTrash:true,count:st.album.startsWith('custom:')?(customAlbums.find(row=>'custom:'+row.id===st.album)?.count??'…'):counts?(st.album==='fav'?counts.favorites:counts.videos):'…',empty:!albumRows.length,
        close:()=>currentApi.set({album:null}),status:st.nativeAlbumError||(albumBusy?'Loading…':''),more:!!albumNext||!!st.nativeAlbumError,moreLabel:st.nativeAlbumError?'Retry':albumBusy?'Loading…':'Load more',loadMore:()=>{void loadAlbum(st.album,currentApi,!st.nativeAlbumError);},
        items:albumRows.map(row=>({nativeMediaId:row.id,bg:row.image?`url("${row.image}") center / cover no-repeat`:'var(--s2)',tf:'',flt:'',vid:row.kind==='video',dur:'',dim:'',alt:`${row.kind==='video'?'Captured video':'Captured photo'} ${new Date(row.date).toLocaleTimeString()}`,...thumbnailEvents(row,currentApi)}))};
    }
    data.libraryLoading = !loaded || loading;
    // Search covers every loaded capture; Load more keeps paging while searching.
    data.libraryMore = !!next && !st.filter;
    data.libraryMoreLabel = loading ? 'Loading…' : 'Load more photos';
    data.libraryLoadMore = () => { if (next) void refresh(true); };
    data.libraryError = st.nativeLibraryError || '';
    data.libraryRetry = () => { void refresh(); };
    const bg = (c: typeof captures[number]) => `url("${c.image}") center / cover no-repeat`;
    const words = st.searching ? captureSearchWords(st.q) : [];
    const shownCaptures = st.filter ? [] : permittedLibrary()?captures:captures.filter(c => captureMatches(c, words));
    data.canSearch = captures.length > 0 || (data.groups || []).some((g: Bag) => g.items?.length);
    if (shownCaptures.length) data.groups = [{ label: words.length ? `${permittedLibrary()?'Permitted library':'Captured on this device'} · ${shownCaptures.length} ${shownCaptures.length === 1 ? 'match' : 'matches'}${next ? ' so far' : ''}` : permittedLibrary()?'Permitted library · up to 240 loaded items':'Captured on this device', place: '', items: shownCaptures.map(c => ({ nativeMediaId: c.id, bg: bg(c), tf: '', flt: '', vid: c.kind === 'video', dur: c.duration ? `${Math.floor(c.duration / 60)}:${String(Math.floor(c.duration % 60)).padStart(2, '0')}` : '', fav: !!c.favorite, dim: '', alt: (c.kind === 'video' ? 'Captured video ' : 'Captured photo ') + new Date(c.date).toLocaleTimeString(), ...thumbnailEvents(c,currentApi) })) }, ...(data.groups || [])];
    const selected = preview?.id === st.open ? preview : captures.find(c => c.id === st.open)||trash.find(c=>c.id===st.open);
    if (selected) {
      if (!st.nativePhotoSelection && preview?.id !== st.open) queueMicrotask(() => { if (currentApi.get('photos').open === selected.id) void openSaved(selected.id, currentApi); });
      data.viewing = true; data.viewEmpty = false; data.editing = !!edit&&edit.source===selected.id;
      data.v = { bg: bg(selected), tf: '', flt: '', slide: '', day: selected.kind === 'video' ? 'Captured video' : 'Captured photo', sub: `${selected.width} × ${selected.height} · ${browserMode?'saved in this app':'saved to Android Photos'}`, chromeOp: 1, chromePE: 'auto', favIcon: selected.favorite ? 'fill:currentColor' : 'fill:none', favLabel: selected.favorite ? 'Remove from favorites' : 'Favorite', vid: selected.kind === 'video', playing: !!video && !video.paused, playBtn: selected.kind === 'video' && (!video || video.paused), prog: `width:${video?.duration ? Math.min(100, video.currentTime / video.duration * 100) : 0}%`, play: () => { void playVideo(selected, currentApi); }, pause: () => { video?.pause(); currentApi.set({ nativePlaybackRevision: Date.now() }); }, notSecure: true, tap: () => {}, down: () => {}, up: () => {}, share: async () => {
        if(sharing || mutating)return;
        sharing=true;
        try { const input={id:nativeId(selected.id),revision:selected.mutationRevision},token=photoReadEpoch,current=()=>!disposed&&!document.hidden&&photoReadEpoch===token&&currentApi.isActive()&&currentApi.get('photos').open===selected.id&&sameCapture(selected),result:Awaited<ReturnType<typeof nativeLibrary.share>>=browserMode?await browserPhotoLibrary.share(input,current):await nativeLibrary.share(input); if(result.status!=='opened')currentApi.toast(result.message||'Sharing could not open.'); }
        catch(error) { if(!(browserMode&&error instanceof DOMException&&error.name==='AbortError'))currentApi.toast(browserMode&&error instanceof Error?error.message:'This photo is no longer available for sharing.'); }
        finally { sharing=false; }
      }, fav: () => { void favorite(selected,currentApi); }, edit: () => {void beginEdit(selected,currentApi);}, del: () => { void changeTrash(selected, true, currentApi); }, info: (event:Event) => openAlbumManager(currentApi,selected,undefined,event.currentTarget as HTMLElement), ask: () => { askCapture(selected,currentApi); } };
      data.v.saveLocally=browserMode?()=>{const token=photoReadEpoch;return saveBrowserMedia({items:[{id:nativeId(selected.id),revision:selected.mutationRevision||''}]},()=>!disposed&&!document.hidden&&photoReadEpoch===token&&currentApi.isActive()&&currentApi.get('photos').open===selected.id&&sameCapture(selected));}:undefined;
      data.v.isDeleted=!!selected.trashed;data.v.notDeleted=!selected.trashed;data.v.canDeleteForever=!!selected.trashed;data.v.recover=()=>void changeTrash(selected,false,currentApi);data.v.deleteForever=()=>void preparePermanent(currentApi,[selected]);if(selected.trashed){data.v.notSecure=false;data.v.day=selected.kind==='video'?'Deleted video':'Deleted photo';data.v.sub=selected.expiresAt?'Expires '+new Date(selected.expiresAt).toLocaleDateString():'Recently deleted';}
      data.v.viewerLabel=`${selected.kind==='video'?'Video':'Photo'}. Tap to show or hide controls, swipe to browse`;data.v.askLabel=`Ask Alpha about this ${selected.kind==='video'?'video':'photo'}`;
      data.v.editLabel=selected.kind==='video'?'Edit video':'Edit photo';data.v.shareLabel=selected.kind==='video'?'Share video':'Share photo';data.v.infoLabel=selected.kind==='video'?'Video info':'Photo info';data.v.deleteLabel=selected.kind==='video'?'Delete video':'Delete photo';
      data.v.canEmail=!browserMode&&selected.kind!=='video'&&!selected.trashed&&nativeId(selected.id).startsWith('m:')&&!!selected.mutationRevision&&Capacitor.isPluginAvailable('AlphaMailAttachments')&&typeof views.inbox.fileEmailTarget==='function';
      data.v.email=()=>emailPhoto(selected,currentApi);
      if(edit?.source===selected.id){const current=edit;data.v.ed={bg:`url("${current.image}") center / contain no-repeat`,tf:'',flt:'none',cropOn:current.crop,cropCss:current.crop?'background:#ffffff;color:#000000':'background:rgba(255,255,255,.12);color:#ffffff',status:current.uncertain?'Save outcome unresolved. Save checks the existing operation; it never creates another copy.':`Saves a new copy · original unchanged${current.reduced?' · reduced to '+current.maxEdge+' px maximum':''}. Crop trims the center at 1.3×.`,saveDisabled:current.busy,rotate:()=>void transformEdit(currentApi,true),crop:()=>void transformEdit(currentApi,false),cancel:()=>{cancelEdit();currentApi.set({nativeEditRevision:Date.now()});},save:()=>void saveEdit(currentApi),filters:[['none','Original'],['vivid','Vivid'],['warm','Warm'],['cool','Cool'],['mono','Mono'],['fade','Fade'],['noir','Noir']].map(([id,label])=>({label,bg:`url("${selected.image}") center / cover no-repeat`,flt:({none:'none',vivid:'saturate(1.55) contrast(1.08)',warm:'sepia(.3) saturate(1.35) hue-rotate(-8deg)',cool:'saturate(1.1) hue-rotate(14deg) brightness(1.03)',mono:'grayscale(1) contrast(1.05)',fade:'contrast(.78) brightness(1.12) saturate(.75)',noir:'grayscale(1) contrast(1.55) brightness(.88)'} as Record<string,string>)[id],on:current.filter===id,ring:current.filter===id?'box-shadow:0 0 0 2px #000,0 0 0 4px #fff':'',lc:current.filter===id?'#fff':'rgba(255,255,255,.6)',pick:()=>void transformEdit(currentApi,false,id)}))};}
    }
    return data;
  };
  if (views.photos) views.photos.back = (st: Bag, currentApi: Bag) => { if(edit){cancelEdit();currentApi.set({nativeEditRevision:Date.now()});return true;}if(selection){cancelPhotoSelection(currentApi);return true;}if(st.sheet==='owned-album'){manager=undefined;currentApi.set({sheet:null});return true;}if(st.sheet==='empty'){cancelPermanent(currentApi);return true;}if(st.sheet)return photosBack?.(st,currentApi); if (preview?.id === st.open || captures.some(c => c.id === st.open) || albumRows.some(c => c.id === st.open)) { retirePhotoRead();currentApi.set({ open: null, nativePhotoSelection: null }); preview = undefined; closeVideo(); return true; } return photosBack?.(st, currentApi); };
  if(views.photos)views.photos.onLeave=(owner:Bag)=>{retirePhotoRead();deviceLibrary.leave();owner.set({nativeLibrarySelection:null});closeQuestion?.();closeQuestion=undefined;void photoAttachments.cancelPhotoSelected().catch(()=>{});cancelEdit();editRecoveryChecked=false;automaticEditRecovery='';selection=undefined;selectionTab=undefined;swallowedTap='';endHold();manager=undefined;const old=prepared;prepared=undefined;if(old)void library.cancelDeleteTrash({confirmation:old.confirmation}).catch(()=>{});owner.set({sheet:null});photosLeave?.(owner);};
  async function playVideo(selected: SavedPhoto, owner: Bag) {
    if (selected.kind !== 'video') return;
    try {
      // Read verifies published MediaStore ownership before returning its local URI.
      const row = preview?.id === selected.id ? preview : normalize(await library.read({ id: nativeId(selected.id) }));
      if (!row.path || owner.get('photos').open !== selected.id || !owner.isActive()) return;
      if (videoId !== selected.id) {
        closeVideo(); video = document.createElement('video'); videoId = selected.id;
        video.dataset.alphaCapturedVideo = selected.id; video.playsInline = true; video.preload = 'metadata';
        video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;background:#000';
        video.src = row.path;
        video.setAttribute('type', 'video/mp4');
        const update = () => { if (owner.isActive() && owner.get('photos').open === selected.id) owner.set({ nativePlaybackRevision: Date.now() }); };
        video.onplay = update; video.onpause = update; video.ontimeupdate = update; video.onended = update;
        video.onerror = () => { closeVideo(); owner.toast('This saved video could not be played.'); update(); };
      }
      mountVideo(); await video?.play();
    } catch { owner.toast('Video playback could not start. Tap Play to retry.'); }
  }
  function mountVideo() {
    if (!video) return;
    const owner = photosApi;
    if (document.hidden || !owner?.isActive() || owner.get('photos').open !== videoId || ['sheet', 'full'].includes(owner.S.chat)) { closeVideo(); return; }
    const frame = document.querySelector('[data-alpha-photo-frame]');
    if (frame && video.parentElement !== frame) frame.insertBefore(video, frame.firstElementChild?.nextSibling ?? null);
  }
  let polling = false;
  const timer = window.setInterval(async () => {
    if (!recording || polling || finalizing) return;
    polling = true;
    try { const state = await camera.getRecordingState(); if (recording) { duration = state.duration; if (!state.isRecording) void finishVideo(); else api?.set({ nativeRecordingTick: duration }); } }
    catch { if (recording) void finishVideo(); }
    finally { polling = false; }
  }, 500);
  let queued = false;
  let libraryWatching=false;
  const watchLibrary=(want:boolean)=>{if(browserMode||want===libraryWatching)return;libraryWatching=want;void nativeLibrary.watchLibrary({active:want}).catch(()=>{libraryWatching=false;});};
  const sync = () => { queued = false;watchLibrary(!disposed&&!document.hidden&&!!photosApi?.isActive()&&permittedLibrary());if((edit||videoEditSource)&&(!photosApi?.isActive()||photosApi.get('photos').open!==(edit?.source??videoEditSource)))cancelEdit(); mountVideo(); if (active()) { if (phase === 'off') void start(); else if (phase === 'ready') mask(true); } else if (phase !== 'off') void stop(); };
  const schedule = () => { if (!queued && !disposed) { queued = true; requestAnimationFrame(sync); } };
  const observer = new MutationObserver(schedule); observer.observe(document.body, { childList: true, subtree: true });
  const resize = () => { if (phase === 'ready') mask(true); schedule(); };
  const visibility = () => { if (document.hidden) { retirePhotoRead();watchLibrary(false);cancelEdit();closeVideo();if(permittedLibrary()){++libraryEpoch;captures=[];albumRows=[];trash=[];albumNext='';trashNext='';albumKey='';counts=undefined;++countsEpoch;countsBusy=false;++albumsEpoch;albumsBusy=false;albumsLoaded=false;customAlbums=[];++albumEpoch;++trashEpoch;preview=undefined;selection=undefined;next='';loaded=false;photosApi?.set({open:null,nativePhotoSelection:null,nativeCaptureRevision:Date.now()});}void stop(); } else { loaded = false; if (photosApi?.isActive()) void refresh(); schedule(); } };
  let libraryChangeHandle:{remove():Promise<void>}|undefined;
  function invalidateLibrary(preserveViewer=false){
    retirePhotoRead();
    ++libraryEpoch;captures=[];albumRows=[];trash=[];albumNext='';trashNext='';albumKey='';counts=undefined;++countsEpoch;countsBusy=false;++albumsEpoch;albumsBusy=false;albumsLoaded=false;customAlbums=[];++albumEpoch;++trashEpoch;selection=undefined;next='';loaded=false;
    if(!preserveViewer){preview=undefined;cancelEdit();closeVideo();photosApi?.set({open:null,nativePhotoSelection:null,nativeCaptureRevision:Date.now()});}
    else photosApi?.set({nativePhotoSelection:null,nativeCaptureRevision:Date.now()});
    if(photosApi?.isActive()&&!document.hidden)void refresh();
  }
  function checkPendingVideoSource(copy:PendingNativeVideoCopy){
    copy.checkAgain=true;if(copy.checking)return;
    copy.checking=(async()=>{
      while(copy.checkAgain&&pendingNativeVideoCopy===copy&&editEpoch===copy.epoch){
        copy.checkAgain=false;
        try{
          const [access,source]=await Promise.all([nativeLibrary.libraryAccess(),nativeLibrary.read({id:nativeId(copy.source.id)})]);
          if(disposed||pendingNativeVideoCopy!==copy||editEpoch!==copy.epoch)return;
          if(access.scope==='denied'||access.videos==='denied'||source.id!==nativeId(copy.source.id)||source.mutationRevision!==copy.source.mutationRevision||source.trashed){invalidateLibrary();return;}
          libraryAccess=access;
        }catch{if(!disposed&&pendingNativeVideoCopy===copy&&editEpoch===copy.epoch)invalidateLibrary();return;}
      }
    })().finally(()=>{copy.checking=undefined;});
  }
  if(!browserMode)void nativeLibrary.addListener('libraryChanged',()=>{
    if(disposed||!permittedLibrary())return;
    const copy=pendingNativeVideoCopy;
    // Our pending output changes the catalog too. Keep observing, but recheck
    // the exact source/access instead of aborting its own in-flight Save.
    if(copy&&copy.epoch===editEpoch&&videoEditSource===copy.source.id){copy.refresh=true;checkPendingVideoSource(copy);return;}
    invalidateLibrary();
  }).then(handle=>{if(disposed)void handle.remove();else libraryChangeHandle=handle;}).catch(()=>{});
  const albumsChanged=()=>{if(!browserMode||disposed)return;albumsLoaded=false;albumsBusy=false;++albumsEpoch;albumKey='';albumBusy=false;++albumEpoch;if(photosApi?.isActive()){void loadCustomAlbums(photosApi);const key=photosApi.get('photos').album;if(typeof key==='string'&&key.startsWith('custom:'))void loadAlbum(key,photosApi);}};
  window.addEventListener('alpha:albums-document-changed',albumsChanged);
  const pageHide=()=>{cancelEdit();closeVideo();void stop();};
  document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', pageHide); window.addEventListener('resize', resize); schedule();
  // Returning from Android settings: a camera grant restarts the preview without another tap.
  const resumed=()=>{void restartAfterResume(()=>({denied,phase,disposed}),()=>cameraAccess.checkPermissions()).then(restart=>{if(restart){phase='off';schedule();}});};
  let resumeHandle:{remove():Promise<void>}|undefined;
  void DailyApps.addListener('appResumed',resumed).then(handle=>{if(disposed)void handle.remove();else resumeHandle=handle;}).catch(()=>{});
  return () => { if(requestedPhoto===takeRequestedPhoto)requestedPhoto=undefined;window.clearTimeout(noticeTimer);noticeGeneration++;watchLibrary(false);deviceLibrary.dispose();captureQuestion=undefined;void libraryChangeHandle?.remove();hideAccess();void resumeHandle?.remove();window.removeEventListener('alpha:albums-document-changed',albumsChanged);if(scanApi&&prototype.api===scanApi)prototype.api=originalApi;disposed = true;cancelEdit();endHold();selection=undefined; clearInterval(timer); closeVideo(); observer.disconnect(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pageHide); window.removeEventListener('resize', resize); void stop(); style.remove(); captures = []; module.render = render; module.onLeave = leave; module.back = cameraBack; if (views.photos) { views.photos.render = photosRender; views.photos.back = photosBack; views.photos.onLeave = photosLeave; } };

}
