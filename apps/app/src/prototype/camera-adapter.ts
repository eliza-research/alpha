import {validateCameraCaptureResult,type CameraCaptureResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/camera-contract.ts';
// Shared camera host rules: explicit-denial classification and resume recovery that never re-prompts.
import {cameraAccessDenied,restartAfterResume,type CameraAccessKind as AccessKind} from '../../../../.eliza/client-features/plugins/plugin-native-camera/src/host-ports.ts';
// The shared camera session owns the preview/capture/recording lifecycle; this adapter presents it.
import {createCameraSession} from '../../../../.eliza/client-features/plugins/plugin-native-camera/src/session.ts';
// A scanned page reaches Photos only through its explicit Keep, under one operation identity per capture.
import {createScanCapture} from '../../../../.eliza/client-features/plugins/plugin-native-camera/src/scan-document.ts';
import type {CameraKeepOutcome} from '../../../../.eliza/client-features/plugins/plugin-native-camera/src/host-ports.ts';
import {reviewFileEmail} from './file-email-review';
import {connectionController} from '../runtime/connection-ui';
import type {MailAttachment} from '../runtime/inbox-attachment';
import {readMediaCopyIntent,admitMediaCopyIntent,acknowledgeMediaCopyIntent,mediaCopyIntentDocument,type MediaCopyIntent} from '../runtime/media-copy-intent';
import {createInlineModal} from '../runtime/inline-modal';
import {reviewContentQuestion} from '../browser/content-question';
import {createCaptureRevisions,captureUnchanged} from './context-selection';
import {createDeviceLibrary,setMainLibraryHost,LibraryAgentRefusal,type HostOperation} from './photo-library-adapter';
import type {PhotosViewResult} from '../runtime/photos-view-contract';
import {virtualGrid,newestFirst,mergeWindow,groupSections,patchRows,insertRows,patchSelection,favoriteTarget,batches,daysLeft,pinchColumns,dragRange,filterMatches,filterLabel,viewerTitle,formatBytes,shotAt,albumOf,GRID_COLUMNS,type PhotosFilter} from '../runtime/photos-view';
import {LIBRARY_LIMITS,type LibraryAgentOperation,type LibraryAgentResult} from '../runtime/photo-library';
import {openVideoEditReview} from './video-edit-review';
import {openScanReview,ScanKeepError} from './scan-review';
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
/** `thumbnail` (a JPEG of at most 256 px) replaces `base64` when a gallery capture asks for `thumbnailOnly`. */
type Photo = { base64?: string; thumbnail?: string; format: string; width: number; height: number; path?: string };
/** The bound lens: its real zoom range, whether it has a flash unit, and the settings it was restored with. */
type Lens = { minZoom: number; maxZoom: number; hasFlash: boolean; zoom: number; flash: boolean };
type PreviewReceipt = { width: number; height: number; deviceId: string; minZoom?: number; maxZoom?: number; hasFlash?: boolean; zoom?: number; flash?: string };
/** Android wire subset. Upstream's HTMLElement is a web-only argument: the
 * pinned Android implementation ignores it and mounts a full-parent PreviewView.
 * Do not serialize a DOM node or invent rectangle arguments. */
const nativeCamera = registerPlugin<{
  startPreview(options: { direction: 'front' | 'back'; resolution: { width: number; height: number }; mirror: boolean }): Promise<PreviewReceipt>;
  stopPreview(): Promise<void>;
  capturePhoto(options: { format: 'jpeg'; quality?: number; saveToGallery: boolean; thumbnailOnly?: boolean }): Promise<Photo>;
  startRecording(options: { audio: boolean; saveToGallery: boolean; quality: string; maxDuration: number; maxFileSize: number }): Promise<void>;
  stopRecording(): Promise<VideoReceipt>;
  getRecordingState(): Promise<{ isRecording: boolean; duration: number; fileSize: number }>;
  switchCamera(options: { direction: 'front' | 'back' }): Promise<PreviewReceipt>;
  /** Binds VideoCapture only for Video mode (patches/eliza/camera-capture-latency.patch). */
  setCaptureMode?(options: { mode: 'photo' | 'video' }): Promise<unknown>;
  setZoom(options: { zoom: number }): Promise<void>;
  setSettings(options: { settings: { flash: 'off' | 'on' } }): Promise<void>;
  setFocusPoint(options: { x: number; y: number }): Promise<void>;
}>('ElizaCamera');
/** A read of the current grant; it never shows Android's permission dialog. */
const cameraAccess = registerPlugin<{ checkPermissions(): Promise<{ camera?: string }> }>('ElizaCamera');
export {restartAfterResume};
type LibraryAccess = {scope:'full'|'partial'|'selected'|'denied';images:'full'|'selected'|'denied';videos:'full'|'selected'|'denied'};
type SavedPhoto = { name?:string;owned?:boolean;folder?:string;taken?:number;size?:number;kind?: 'image' | 'video'; duration?: number; path?: string; id: string; image: string; width: number; height: number; date: number; revision: string; mutationRevision?: string; contentRevision?: string; trashed?: boolean; expiresAt?: number; favorite?: boolean };
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
  saveEdit(options:{sessionId:string;rotation:number;crop:boolean;filter:string;replace?:boolean}):Promise<EditReceipt>;
  editResult(options:{operationId:string}):Promise<EditReceipt>;
  cancelEdit(options:{sessionId:string}):Promise<void>;
  beginVideoEdit(options:{id:string;revision:string}):Promise<{sessionId:string;operationId:string;duration:number;width:number;height:number}>;
  saveVideoEdit(options:{sessionId:string;start:number;end:number;rotation:number;crop:boolean}):Promise<EditReceipt>;
  cancelVideoEdit(options:{sessionId?:string}):Promise<void>;
  list(options: { before?: string; trashed?: boolean; album?: string; limit?: number }): Promise<{ items: SavedPhoto[]; next: string }>;
  read(options: { id: string; includeTrashed?: boolean }): Promise<SavedPhoto>;
  setTrashed(options: { id: string; revision: string; trashed: boolean }): Promise<SavedPhoto & {status:string}>;
  share(options: { id: string;revision?:string }): Promise<{ status: string; message?: string }>;
  setFavorite(options: {id:string;revision:string;favorite:boolean}): Promise<SavedPhoto>;
  deletePermittedTrash(options:{items:{id:string;revision:string}[]}):Promise<{status:string;outcomes:{id:string;status:string}[]}>;
  changeMany(options:{operation:'favorite'|'unfavorite'|'trash'|'restore';items:{id:string;revision:string}[]}):Promise<{status:string;outcomes:{id:string;status:string;item?:SavedPhoto}[]}>;
  shareMany(options:{items:{id:string;revision:string}[]}): Promise<{status:string;count:number;message?:string}>;
  albums(): Promise<{items:OwnedAlbum[]}>;
  changeAlbum(options:Record<string,unknown>): Promise<{status:string;id:string;revision:string}>;
  summary(): Promise<{favorites:number;videos:number;camera?:number;screenshots?:number;trash:number;canFavorite:boolean}>;
  prepareDeleteTrash(options:{items:{id:string;revision:string}[]}|{all:true}): Promise<{confirmation:string;count:number}>;
  cancelDeleteTrash(options:{confirmation:string}): Promise<void>;
  deletePreparedTrash(options:{confirmation:string}): Promise<{status:string;deletedIds:string[];skippedIds:string[];failedIds:string[]}>;
  keepCapture(options:{dataBase64:string;operationId:string}): Promise<{status:string;id?:string;message?:string}>;
}>('AlphaPhotos');
const photoAttachments=registerPlugin<{readPhotoSelected(input:{id:string;revision:string}):Promise<MailAttachment&{size:number;sha256:string}>;cancelPhotoSelected():Promise<void>}>('AlphaMailAttachments');
const device=registerPlugin<{openSettings(options:{page:'privacy'}):Promise<{status:string}>}>('AlphaDevice');
/** Only an explicit permission denial gets settings recovery (shared camera host rule). */
export const mediaAccessDenied=cameraAccessDenied;
let captureQuestion:((item?:{id:string})=>boolean)|undefined;
/** A request to scan what Camera sees; asking Alpha in Camera reaches it. */
let scanRequest:(()=>boolean)|undefined;
export function requestCameraScan():boolean{return scanRequest?.()??false;}
const SCAN_REQUEST=/\bscan\b.*\b(document|doc|receipt|qr|code|poster|page|letter|form|card|menu|sign|this|that|it|text)\b/;
/** Whether a chat message asks to scan what the camera sees. */
export function cameraScanRequested(text:unknown):boolean{return SCAN_REQUEST.test(String(text||'').toLowerCase().slice(0,200));}
export function askAboutCapture(item?:{id:string}):boolean{return captureQuestion?.(item)??false;}
const browserMode=!Capacitor.isNativePlatform();
const camera:typeof nativeCamera=browserMode?browserCamera:nativeCamera;
// Check every implemented browser method against the native port contract.
browserPhotoLibrary satisfies Pick<typeof nativeLibrary,Exclude<keyof typeof browserPhotoLibrary,'saveVideoCopy'|'share'|'shareMany'>>;
const library=browserMode?browserLibrary as unknown as typeof nativeLibrary:nativeLibrary;
const libraryAvailable=()=>browserMode||Capacitor.isPluginAvailable('AlphaPhotos');
/** canReplace: the native edit pipeline can overwrite this original (owned, or Android allows a write request). */
type EditPreview={sessionId:string;operationId:string;image:string;width:number;height:number;reduced:boolean;maxEdge:number;filter:string;canReplace?:boolean};
type EditReceipt={status:string;operationId:string;id?:string;replaced?:boolean;revision?:string;message?:string};
type OwnedAlbum = {id:string;name:string;revision:string;count:number;memberIds:string[]};
const finder = '[data-alpha-camera="viewfinder"]';
/** Zoom chips offered when the bound lens's range covers them. A lens with only 1× shows none. */
const ZOOM_STOPS: [number, string][] = [[0.5, '.5'], [1, '1×'], [2, '2'], [5, '5']];
export function lensFromReceipt(value: unknown): Lens {
  const row = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const min = Number(row.minZoom), max = Number(row.maxZoom), zoom = Number(row.zoom);
  const minZoom = Number.isFinite(min) && min > 0 && min <= 1 ? min : 1, maxZoom = Number.isFinite(max) && max >= 1 ? max : 1;
  return { minZoom, maxZoom, hasFlash: row.hasFlash === true, zoom: Number.isFinite(zoom) && zoom >= minZoom && zoom <= maxZoom ? zoom : 1, flash: row.hasFlash === true && row.flash === 'on' };
}
export function zoomStops(lens: Pick<Lens, 'minZoom' | 'maxZoom'>): [number, string][] {
  const stops = ZOOM_STOPS.filter(([ratio]) => ratio >= lens.minZoom - 1e-3 && ratio <= lens.maxZoom + 1e-3);
  return stops.length > 1 ? stops : [];
}
/** A saved still's receipt: a MediaStore (or browser library) identity, never a file path. */
export function photoReceiptPath(path: unknown, browser: boolean): string | undefined {
  if (typeof path !== 'string') return undefined;
  return (browser ? /^browser-photo:\/\/\/[1-9][0-9]{0,24}$/ : /^content:\/\/media\/(?:external|external_primary)\/images\/media\/[1-9][0-9]{0,18}$/).test(path) ? path : undefined;
}
/** The chat sheet may cover Camera this long before the preview is released (PLAN item 7). */
export const CHAT_GRACE_MS = 10_000;

/**
 * View enter/leave events from the shell itself. The listener runs once after a shell commit
 * (a view opening or closing, the chat covering a view, any state the view renders from) and
 * when the page is hidden or shown. It replaces observing every DOM mutation in the document:
 * views read their own state from the shell, and the DOM they need is committed by then.
 */
type ShellPrototype = { componentDidMount?: (...args: unknown[]) => unknown; componentDidUpdate?: (...args: unknown[]) => unknown };

export function installViewPresence(Component: unknown, changed: () => void): () => void {
  const prototype = (Component as { prototype?: ShellPrototype } | undefined)?.prototype;
  let installed = true;
  const notify = () => { if (installed) changed(); };
  const didMount = prototype?.componentDidMount, didUpdate = prototype?.componentDidUpdate;
  const mounted = function (this: unknown, ...args: unknown[]) { const result = didMount?.apply(this, args); notify(); return result; };
  const updated = function (this: unknown, ...args: unknown[]) { const result = didUpdate?.apply(this, args); notify(); return result; };
  if (prototype) { prototype.componentDidMount = mounted; prototype.componentDidUpdate = updated; }
  document.addEventListener('visibilitychange', notify);
  return () => {
    installed = false;
    document.removeEventListener('visibilitychange', notify);
    // Another adapter may have wrapped these since; then ours stays as a pass-through.
    if (prototype?.componentDidMount === mounted) prototype.componentDidMount = didMount;
    if (prototype?.componentDidUpdate === updated) prototype.componentDidUpdate = didUpdate;
  };
}

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
    if(key==='camera')value.reviewScannedCalendarDraft=(draft:Bag)=>this.reviewScannedCalendarDraft?.(draft)??false;
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
  let direction: 'front' | 'back' = 'back';
  let flash = false, disposed = false;
  let lens: Lens = { minZoom: 1, maxZoom: 1, hasFlash: false, zoom: 1, flash: false }, zoomRatio = 1;
  /** The last-capture tile: this session's newest capture, or one library row read after the preview is ready. */
  let lastCapture: SavedPhoto | undefined;
  let accessPanel: HTMLElement | undefined;
  let duration = 0;
  let video: HTMLVideoElement | undefined, videoId = '';
  function closeVideo() { if (video) { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); } video = undefined; videoId = ''; }
  let captures: SavedPhoto[] = [];
  let photosApi: Bag | undefined, loaded = false, loading = false, next = '', libraryEpoch = 0;
  let libraryAccess:LibraryAccess|undefined,requestingLibraryAccess=false;
  /** The newest rows Photos keeps loaded; a reload re-reads at most RELOAD_LIMIT of them. */
  const WINDOW=LIBRARY_LIMITS.kept,RELOAD_LIMIT=240,BATCH=20,SHARE_BATCH=100;
  /** The agent's read-only filter (photos_filter), shown as a clearable chip. */
  let photosFilter:(PhotosFilter&{label:string})|undefined;
  let gridColumns:number=GRID_COLUMNS.default;
  /** Drag-to-extend: the tile the drag started on and the selection it started from. */
  let drag:{anchor:string;base:SavedPhoto[];order:SavedPhoto[];moved:boolean}|undefined;
  /** An agent album request waiting for the owner (photos_album_create): exact rows and revisions shown. */
  let albumReview:{name:string;items:SavedPhoto[];missing:number}|undefined;
  /** An agent share request waiting for the owner (photos_share). */
  let shareReview:{items:SavedPhoto[];missing:number}|undefined;
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
          finally{signal.removeEventListener('abort',abort);if(pendingCopy&&pendingNativeVideoCopy===pendingCopy){pendingNativeVideoCopy=undefined;if(pendingCopy.refresh&&!disposed)invalidateLibrary();}}
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
  type EditCompletion={token:string;epoch:number;source:string|undefined;intent?:MediaCopyIntent;replace?:boolean};
  const completionCurrent=(ticket:EditCompletion,owner:Bag)=>!disposed&&!document.hidden&&owner.isActive()&&editEpoch===ticket.epoch&&owner.get('photos').open===ticket.source&&(!edit||edit.operationId===ticket.token);
  async function finishEdit(value:EditReceipt,owner:Bag,ticket:EditCompletion){
    // A late/duplicate outcome may only retire its own persisted operation.
    // It cannot consume a new save or cancel/navigate a newer editor/selection.
    if(value.operationId!==ticket.token||!ticket.intent)throw Error('Saved-copy receipt identity changed');
    const terminal=(value.status==='saved'&&!!value.id)||['failed','unchanged','not-started','stale'].includes(value.status);if(!terminal)return false;
    await acknowledgeMediaCopyIntent(ticket.intent);
    // A library notification can arrive while acknowledgement yields too.
    const pendingCopy=pendingNativeVideoCopy;
    if(pendingCopy?.epoch===ticket.epoch&&pendingCopy.source.id===ticket.source)await pendingCopy.checking;
    const updateView=completionCurrent(ticket,owner);
    if(edit?.operationId===ticket.token)cancelEdit();
    if(!updateView)return true;owner.set({nativeCopyRecovery:false});
    if(videoEditSource&&videoEditSource===ticket.source&&closeVideoEdit){const close=closeVideoEdit;closeVideoEdit=undefined;close();}
    if(value.status==='saved'&&value.id&&value.replaced){owner.toast('Saved');retirePhotoRead();preview=undefined;invalidateLibrary();await openSaved('native-camera-'+value.id,owner);}
    else if(value.status==='saved'&&value.id){owner.toast('Copy saved');void refresh();await openSaved('native-camera-'+value.id,owner);}
    else{owner.toast(value.status==='stale'?'Photo changed. Nothing was replaced.':value.status==='failed'?(ticket.replace?'Not saved. Try again.':'Copy not saved. Try again.'):'No changes to save');owner.set({nativeEditRevision:Date.now()});}return true;
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
  async function saveEdit(owner:Bag,replace=false){
    const current=edit;if(!current||current.busy||replace&&!current.canReplace)return;
    const ticket:EditCompletion={token:current.operationId,epoch:editEpoch,source:current.source,replace};
    if(current.uncertain){void recoverEdit(owner);return;}current.busy=true;owner.set({nativeEditRevision:Date.now()});
    try{
      ticket.intent=await admitMediaCopyIntent(ticket.token);automaticEditRecovery=ticket.token;
      if(!completionCurrent(ticket,owner)){await acknowledgeMediaCopyIntent(ticket.intent);return;}
      const value=await library.saveEdit({sessionId:current.sessionId,rotation:current.rotation,crop:current.crop,filter:current.filter,...(replace?{replace:true}:{})});
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
  let counts: {favorites:number;videos:number;camera?:number;screenshots?:number;trash:number;canFavorite:boolean} | undefined, countsBusy = false, countsError = false, countsEpoch = 0;
  let albumRows: SavedPhoto[] = [], albumKey = '', albumNext = '', albumBusy = false, albumEpoch = 0;
  let customAlbums: OwnedAlbum[] = [], albumsLoaded=false, albumsBusy=false, albumsEpoch=0;
  /** media: one item (viewer Info); items: the selection (Add to album). */
  let manager: {media?:SavedPhoto;items?:SavedPhoto[];album?:OwnedAlbum;name:string;creating?:boolean;choosing?:boolean;confirmDelete?:boolean}|undefined;
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
      // One catalog: AlphaPhotos lists every permitted item, or Alpha's own captures without access.
      // A reload re-reads as many rows as were showing (bounded), so a change patches the window in place.
      const want=more?1:Math.min(Math.max(captures.length,1),RELOAD_LIMIT),rows:SavedPhoto[]=[];let cursor=more?next:'';
      do{const result=await library.list(cursor?{before:cursor}:{});if(disposed||token!==libraryEpoch)return;rows.push(...result.items.map(normalize));cursor=result.next;}while(cursor&&!more&&rows.length<want);
      captures = more ? mergeWindow(captures, rows, WINDOW) : newestFirst(rows).slice(0, WINDOW);
      next = cursor; loaded = true; loading = false;
      patchView();
      photosApi?.set({ nativeLibraryError: '', nativeCaptureRevision: token });
      if (!more && photosApi) { void loadCounts(photosApi); void loadCustomAlbums(photosApi); }
      if (api?.isActive()) api.set({ nativeCaptureRevision: token });
    } catch { loaded = true; loading = false; if (!disposed) photosApi?.set({ nativeLibraryError: 'Photos could not be loaded. Tap to retry.' }); }
    finally { loading = false; if (refreshAgain && !disposed) { refreshAgain = false; queueMicrotask(() => { void refresh(); }); } }
  }
  /** The rows a selection may hold: what the open list shows (SelectionSubsetOfVisible). */
  function selectionPool(owner:Bag|undefined=photosApi):SavedPhoto[]{
    const album=owner?.get('photos')?.album;
    if(album==='trash')return trash;
    if(album)return albumRows;
    return captures.filter(row=>filterMatches(row,photosFilter,albumMembers));
  }
  const albumMembers=(key:string)=>{const album=customAlbums.find(row=>'custom:'+row.id===key);return album?.memberIds.map(id=>'native-camera-'+id);};
  /** After any load: keep selected rows that still exist (with their current revision); close the
   * viewer only when its item is gone (FixPatch). Unrelated store events change nothing visible. */
  function patchView(){
    if(selection&&!mutating&&!sharing){selection=patchSelection(selection,selectionPool());photosApi?.set({nativeMultiSelection:Date.now()});}
    const owner=photosApi,open=owner?.get('photos')?.open;
    if(!owner||!open||edit||closeVideoEdit)return;
    const live=[...captures,...albumRows,...trash].find(row=>row.id===open);
    const shown=preview;
    if(live){if(shown&&shown.id===open&&(live.mutationRevision!==shown.mutationRevision||!!live.trashed!==!!shown.trashed||live.favorite!==shown.favorite)){preview={...shown,...live};owner.set({nativePhotoSelection:captureSelection(preview)});}return;}
    // Not in a loaded list (it may be on a later page): read it; only a missing item closes the viewer.
    const token=photoReadEpoch;
    void library.read({id:nativeId(open),includeTrashed:true}).then(row=>{if(disposed||token!==photoReadEpoch||owner.get('photos').open!==open)return;const fresh=normalize(row);if(preview?.id===open)preview={...preview,...fresh};},()=>{
      if(disposed||token!==photoReadEpoch||owner.get('photos').open!==open)return;
      retirePhotoRead();preview=undefined;closeVideo();owner.set({open:null,nativePhotoSelection:null,sheet:null,nativeCaptureRevision:Date.now()});
    });
  }
  function toggleSelection(row:SavedPhoto,owner:Bag){
    if(!selection||mutating||sharing)return;
    if(selection.some(item=>item.id===row.id))selection=selection.filter(item=>item.id!==row.id);
    else selection=[...selection,row];
    owner.set({nativePhotoSelection:null,nativeMultiSelection:Date.now()});
  }
  function startSelection(owner:Bag,rows:SavedPhoto[]=[]){
    if(mutating||sharing)return;
    const st=owner.get('photos');selection=rows;selectionTab=st?.tab==='alb'?'alb':'lib';swallowedTap='';endHold();
    owner.set({open:null,nativePhotoSelection:null,nativeMultiSelection:Date.now()});
  }
  /** Drag over tiles after a long press, or while selecting, selects the range in grid order. */
  function dragTo(event:PointerEvent,owner:Bag){
    if(!drag||!selection)return;
    const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-owned-media-id]'),id=target?.dataset.ownedMediaId;
    if(!id||(!drag.moved&&id===drag.anchor))return;
    drag.moved=true;swallowedTap=drag.anchor;
    const range=dragRange(drag.order,drag.anchor,id),ids=new Set(drag.base.map(row=>row.id));
    selection=[...drag.base,...range.filter(row=>!ids.has(row.id))];
    owner.set({nativeMultiSelection:Date.now()});
  }
  function thumbnailEvents(row:SavedPhoto,owner:Bag,order:SavedPhoto[]){const on=!!selection?.some(item=>item.id===row.id);return {
    selecting:!!selection,on,pressed:selection?on:undefined,selCss:on?'background:var(--acc);box-shadow:0 0 0 2px #ffffff':'background:rgba(0,0,0,.35);box-shadow:inset 0 0 0 2px #ffffff',tileCss:on?'transform:scale(.88);border-radius:6px':'',
    tap:()=>{endHold();if(swallowedTap===row.id){swallowedTap='';return;}if(selection)toggleSelection(row,owner);else void openSaved(row.id,owner);},
    pd:(event?:PointerEvent)=>{endHold();if(sharing||mutating)return;
      // Keep the pointer on this tile so moving across others extends instead of ending the press.
      try{if(event&&event.currentTarget instanceof Element)event.currentTarget.setPointerCapture(event.pointerId);}catch{/* not capturable */}
      if(selection){drag={anchor:row.id,base:selection.filter(item=>item.id!==row.id),order,moved:false};if(!on)drag.base=[...selection];return;}
      holdTimer=window.setTimeout(()=>{holdTimer=undefined;if(!owner.isActive()||disposed)return;startSelection(owner,[row]);swallowedTap=row.id;drag={anchor:row.id,base:[],order,moved:false};},450);},
    pm:(event:PointerEvent)=>{if(drag)dragTo(event,owner);},
    pu:()=>{endHold();drag=undefined;window.setTimeout(()=>{swallowedTap='';},0);},
  };}
  async function shareSelection(owner:Bag){
    if(!selection?.length||sharing||mutating)return;if(selection.length>SHARE_BATCH){owner.toast(`Share up to ${SHARE_BATCH} at a time.`);return;}const chosen=selection,token=photoReadEpoch,current=()=>!disposed&&!document.hidden&&photoReadEpoch===token&&owner.isActive()&&selection===chosen&&chosen.every(sameCapture);sharing=true;owner.set({nativeMultiSelection:Date.now()});
    try{const items=chosen.map(row=>({id:nativeId(row.id),revision:row.mutationRevision||''})),result:Awaited<ReturnType<typeof nativeLibrary.shareMany>>=browserMode?await browserPhotoLibrary.shareMany({items},current):await nativeLibrary.shareMany({items});if(owner.isActive()&&result.message)owner.toast(result.message);}
    catch(error){if(owner.isActive()&&!(browserMode&&error instanceof DOMException&&error.name==='AbortError'))owner.toast(error instanceof Error?error.message:'Selection could not be shared. Reselect the items.');}
    finally{sharing=false;if(!disposed)owner.set({nativeMultiSelection:Date.now()});}
  }
  /** Batch change of the selection (or of Undo's items). Large selections run in native-sized batches;
   * rows are patched in place, so favorite and restore never reorder the grid. */
  async function changeSelection(owner:Bag,operation:'favorite'|'trash'|'restore',undoItems?:SavedPhoto[]){
    if(mutating||sharing||disposed)return;
    const chosen=undoItems||selection;if(!chosen?.length)return;
    const native:'favorite'|'unfavorite'|'trash'|'restore'=operation==='favorite'?(favoriteTarget(chosen)?'favorite':'unfavorite'):operation;
    mutating=true;closeVideo();preview=undefined;retirePhotoRead();
    owner.set({open:null,nativePhotoSelection:null,nativeMultiSelection:Date.now()});
    const verified:SavedPhoto[]=[],changed:SavedPhoto[]=[];let failed=0,unverified=false;
    try{
      for(const batch of batches(chosen,BATCH)){
        if(disposed)return;
        let receipt;try{receipt=await library.changeMany({operation:native,items:batch.map(row=>({id:nativeId(row.id),revision:row.mutationRevision||''}))});}
        catch{unverified=true;failed+=batch.length;continue;}
        for(const outcome of receipt.outcomes){if(!outcome.item){failed++;continue;}const before=batch.find(item=>nativeId(item.id)===outcome.id);const item={...before,...normalize(outcome.item)} as SavedPhoto;verified.push(item);if(outcome.status!=='unchanged')changed.push(item);}
        failed+=Math.max(0,batch.length-receipt.outcomes.length);
      }
      if(disposed)return;
      ++libraryEpoch;++trashEpoch;albumKey='';++albumEpoch;
      const live=verified.filter(row=>!row.trashed),gone=verified.filter(row=>row.trashed);
      captures=insertRows(patchRows(captures,verified,row=>!row.trashed),operation==='restore'?live:[]);
      trash=insertRows(patchRows(trash,verified,row=>!!row.trashed),operation==='trash'?gone:[]);
      albumRows=patchRows(albumRows,verified,row=>!row.trashed);
      if(owner.isActive()){
        selection=undefined;selectionTab=undefined;
        owner.set({nativeMultiSelection:Date.now(),nativeCaptureRevision:Date.now()});
        const n=verified.length,message=operation==='favorite'?(native==='favorite'?`Added ${n} to Favorites`:`Removed ${n} from Favorites`):operation==='trash'?`${n} moved to Recently deleted`:`${n} restored`;
        const undo=operation==='trash'?changed.filter(row=>row.trashed):[];
        owner.toast(message+(failed?` · ${failed} not changed`:''),undo.length?{undo:()=>{void changeSelection(owner,'restore',undo);}}:undefined);
      }
      if(unverified&&!verified.length&&owner.isActive())owner.toast('Nothing changed. Try again.');
    }finally{mutating=false;if(!disposed){void refresh();void loadTrash(owner);void loadCounts(owner);void loadCustomAlbums(owner);owner.set({nativeMultiSelection:Date.now()});}}
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
    catch{const recovery=await albumStoreNeedsRecovery().catch(()=>false);if(!disposed&&token===albumsEpoch){albumsLoaded=true;albumsRecovery=recovery;owner.set({nativeAlbumsError:recovery?'Albums could not be read.':'Albums could not be loaded.',nativeAlbumsRevision:token});}}
    finally{if(token===albumsEpoch)albumsBusy=false;}
  }
  function openAlbumManager(owner:Bag,media?:SavedPhoto,album?:OwnedAlbum,trigger?:HTMLElement){
    albumTrigger=trigger||(document.activeElement instanceof HTMLElement?document.activeElement:null);
    manager={media,album,name:album?.name||''};owner.set({sheet:'owned-album'});void loadCustomAlbums(owner);
  }
  /** Adds rows one by one at their shown revisions; a row changed since is skipped by the store. */
  async function addMembers(album:{id:string;revision:string},rows:SavedPhoto[]):Promise<{added:number;skipped:number}>{
    let revision=album.revision,added=0,skipped=0;
    for(const row of rows){if(disposed)break;try{const result=await library.changeAlbum({operation:'add',id:album.id,revision,mediaId:nativeId(row.id),mediaRevision:row.mutationRevision});revision=result.revision;added++;}catch{skipped++;try{revision=(await library.albums()).items.find(item=>item.id===album.id)?.revision||revision;}catch{/* keep the last revision */}}}
    return {added,skipped};
  }
  async function mutateAlbum(owner:Bag,operation:string,target?:OwnedAlbum){
    const current=manager;if(!current||mutating||disposed)return;
    const album=target||current.album,media=current.media,items=current.items;
    mutating=true;owner.set({nativePhotoMutation:Date.now()});
    try{
      let note='';
      if(items?.length&&(operation==='create'||operation==='add')){
        // Add to album from a selection: create (with the first item), then add the rest.
        const [first,...rest]=items;let base:{id:string;revision:string};
        if(operation==='create'){const created=await library.changeAlbum({operation:'create',name:current.name,mediaId:nativeId(first.id),mediaRevision:first.mutationRevision});base={id:created.id,revision:created.revision};}
        else base={id:album!.id,revision:album!.revision};
        const result=await addMembers(base,operation==='create'?rest:items);
        const name=operation==='create'?current.name.trim():album!.name,count=result.added+(operation==='create'?1:0);
        note=`Added ${count} to “${name}”`+(result.skipped?` · ${result.skipped} not added`:'');
      }else await library.changeAlbum({operation,...(album?{id:album.id,revision:album.revision}:{}),...(media?{mediaId:nativeId(media.id),mediaRevision:media.mutationRevision}:{}),name:current.name});
      if(disposed)return;
      albumKey='';++albumEpoch;
      if(manager===current&&owner.isActive()&&owner.get('photos').sheet==='owned-album'){
        manager=undefined;
        if(items){selection=undefined;selectionTab=undefined;}
        owner.set({sheet:null,...(operation==='delete'?{album:null,open:null,nativePhotoSelection:null}:{}),nativeAlbumsError:'',nativeMultiSelection:Date.now()});
        if(note)owner.toast(note);
        else if(operation==='delete'||operation==='remove')owner.toast(operation==='delete'?'Album deleted':'Removed from album');
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
  const ALBUM_KEYS:Record<string,string>={fav:'favorites',video:'videos',camera:'camera',shot:'screenshots'};
  async function loadAlbum(key: string, owner: Bag, more = false) {
    if (disposed || (albumBusy && albumKey === key && more)) return;
    const token = ++albumEpoch, same = albumKey === key; albumKey = key; albumBusy = true;
    // Reloading the open album keeps its rows until the new page arrives, so a selection survives.
    if (!more && !same) { albumRows = []; albumNext = ''; }
    try {
      const result = await library.list({ album: key.startsWith('custom:') ? key : ALBUM_KEYS[key] ?? 'videos', ...(more ? {before:albumNext} : {}) });
      if (disposed || token !== albumEpoch) return;
      const rows = result.items.map(normalize); albumRows = more ? mergeWindow(albumRows, rows, WINDOW) : newestFirst(rows);
      albumNext = result.next; patchView(); owner.set({nativeAlbumError:'',nativeAlbumRevision:token});
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
      const updated = {...row,...result}; captures = patchRows(captures,[updated],()=>true); albumRows = patchRows(albumRows,[updated],()=>true);
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
      if(permittedLibrary()&&!selected?.length){owner.toast('Select items first.');return;}
      // Permitted media and large selections are deleted in batches after this one confirmation.
      const result=permittedLibrary()||selected&&selected.length>BATCH?{confirmation:'',count:selected!.length,items:selected}:await library.prepareDeleteTrash(selected?{items:selected}:{all:true});
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
      if(snapshot.items){
        result={deletedIds:[],skippedIds:[],failedIds:[]};
        for(const batch of batches(snapshot.items,BATCH)){
          if(disposed)return;
          if(permittedLibrary()){const receipt=await nativeLibrary.deletePermittedTrash({items:batch});for(const item of batch){const outcome=receipt.outcomes.find(row=>row.id===item.id);if(outcome?.status==='deleted')result.deletedIds.push(item.id);else if(outcome?.status==='stale')result.skippedIds.push(item.id);else result.failedIds.push(item.id);}}
          else{const ticket=await library.prepareDeleteTrash({items:batch}),receipt=await library.deletePreparedTrash({confirmation:ticket.confirmation});result.deletedIds.push(...receipt.deletedIds);result.skippedIds.push(...receipt.skippedIds);result.failedIds.push(...receipt.failedIds);}
        }
      }
      else result=await library.deletePreparedTrash({confirmation:snapshot.confirmation});
      if(disposed)return;
      ++libraryEpoch;++trashEpoch;const deleted=new Set(result.deletedIds.map(id=>'native-camera-'+id));trash=trash.filter(row=>!deleted.has(row.id));captures=captures.filter(row=>!deleted.has(row.id));preview=undefined;
      const remaining=result.skippedIds.length+result.failedIds.length;
      selection=selection?.filter(row=>!deleted.has(row.id));if(!selection?.length)selection=undefined;owner.set({sheet:null,open:null,nativePhotoSelection:null,nativeTrashMutationStatus:remaining?`${remaining} not deleted. Try again.`:''});
      owner.toast(`${result.deletedIds.length} deleted`);
      void refresh();void loadTrash(owner);void loadCounts(owner);void loadCustomAlbums(owner);
    }catch(error){if(!disposed){owner.set({sheet:null,nativeTrashMutationStatus:'Not deleted. Try again.'});owner.toast(error instanceof Error?error.message:'Deletion failed.');void loadTrash(owner);}}
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
      trash = more ? mergeWindow(trash, rows, WINDOW) : newestFirst(rows);
      trashNext = result.next; trashLoaded = true; patchView();
      owner.set({ nativeTrashError: '', nativeTrashRevision: Date.now() });
    } catch { if (!disposed) owner.set({ nativeTrashError: browserMode?'Browser trash could not be loaded. Tap to retry.':'Android trash could not be loaded. Android 11 or later is required.' }); }
    finally { trashLoading = false; if (trashRefreshAgain && !disposed) { trashRefreshAgain = false; queueMicrotask(() => { void loadTrash(owner); }); } }
  }
  async function changeTrash(row: SavedPhoto, desired: boolean, owner: Bag, nextId?: string) {
    if (mutating || sharing || disposed) return;
    if (!row.mutationRevision) { owner.toast('Refresh Photos before changing this media.'); return; }
    mutating = true; closeVideo();
    try {
      const result = normalize(await library.setTrashed({ id: nativeId(row.id), revision: row.mutationRevision, trashed: desired }));
      if (disposed) return;
      ++libraryEpoch; ++trashEpoch; const updated = { ...row, ...result };
      captures = insertRows(captures.filter(item => item.id !== row.id), desired ? [] : [updated]); albumRows = albumRows.filter(item => item.id !== row.id);
      trash = insertRows(trash.filter(item => item.id !== row.id), desired ? [updated] : []);
      preview = undefined; retirePhotoRead();
      owner.set({ open: null, nativePhotoSelection: null, sheet: null, sel: null, nativeCaptureRevision: Date.now() });
      // Delete in the viewer moves on to the neighbouring item.
      if (nextId && owner.isActive()) void openSaved(nextId, owner);
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
  /** The masked geometry. The marked ancestors and underlay siblings are kept until the viewfinder
   * or the screen's own children change (a childList observer on the screen alone), so a repeated
   * mask(true) only re-reads the hole's edges. */
  let maskCache: { vf: HTMLElement; screen: HTMLElement; top: string; bottom: string } | undefined;
  let screenChildren: MutationObserver | undefined;
  function unmask() {
    screenChildren?.disconnect(); screenChildren = undefined; maskCache = undefined;
    for (const el of marked) {
      el.removeAttribute('data-alpha-camera-clear'); el.removeAttribute('data-alpha-camera-screen'); el.removeAttribute('data-alpha-camera-frame'); el.removeAttribute('data-alpha-camera-underlay');
      el.style.removeProperty('--alpha-camera-top'); el.style.removeProperty('--alpha-camera-bottom');
    }
    marked.clear();
  }
  function mask(enable: boolean) {
    if(browserMode){if(enable)mountBrowserCamera();return;}
    if (!enable) { unmask(); return; }
    const vf = document.querySelector<HTMLElement>(finder);
    const screen = vf?.closest<HTMLElement>('[data-screen]');
    if (!vf || !screen) { unmask(); return; }
    if (!maskCache || maskCache.vf !== vf || maskCache.screen !== screen || [...marked].some(el => !el.isConnected)) {
      unmask();
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
      screen.setAttribute('data-alpha-camera-screen', ''); marked.add(screen);
      // The prototype's separate decorative device frame sits behind data-screen.
      // It must not cover the actual native preview through the transparent hole.
      const frame = screen.parentElement?.firstElementChild;
      if (frame instanceof HTMLElement && frame !== screen && !frame.contains(screen)) { frame.setAttribute('data-alpha-camera-frame', ''); marked.add(frame); }
      maskCache = { vf, screen, top: '', bottom: '' };
      // A sibling added or removed under the screen invalidates the underlay list.
      screenChildren = new MutationObserver(() => { maskCache = undefined; schedule(); });
      screenChildren.observe(screen, { childList: true });
    }
    const rect = vf.getBoundingClientRect(), sr = screen.getBoundingClientRect();
    const scale = sr.width / (screen.offsetWidth || 412);
    const top = `${(rect.top - sr.top) / scale}px`, bottom = `${(rect.bottom - sr.top) / scale}px`;
    if (maskCache.top !== top) { screen.style.setProperty('--alpha-camera-top', top); maskCache.top = top; }
    if (maskCache.bottom !== bottom) { screen.style.setProperty('--alpha-camera-bottom', bottom); maskCache.bottom = bottom; }
  }
  let requestedCaptureActive=false;
  const cameraViewVisible = () => !disposed && !document.hidden && !!api?.isActive() && !!document.querySelector(finder);
  const chatCovers = () => ['sheet', 'full'].includes(api?.S.chat);
  /** When the chat sheet started covering Camera; the session stays bound for CHAT_GRACE_MS after that. */
  let chatCoveredAt: number | undefined, chatTimer: number | undefined;
  function trackChat() {
    const covered = cameraViewVisible() && chatCovers();
    if (covered && chatCoveredAt === undefined) { chatCoveredAt = Date.now(); chatTimer = window.setTimeout(() => { chatTimer = undefined; schedule(); }, CHAT_GRACE_MS); }
    else if (!covered && chatCoveredAt !== undefined) { chatCoveredAt = undefined; window.clearTimeout(chatTimer); chatTimer = undefined; }
  }
  const chatGrace = () => chatCoveredAt === undefined || Date.now() - chatCoveredAt < CHAT_GRACE_MS;
  const active = () => cameraViewVisible() && (requestedCaptureActive || !chatCovers() || chatGrace());
  /** The one photo being written natively, if any; releasing the preview waits for it. */
  let photoWrite: Promise<unknown> | undefined;
  let previewReceipt: PreviewReceipt | undefined;
  /** Bind VideoCapture only while Video mode is chosen. Builds without setCaptureMode bind it when recording starts. */
  let modeChange: Promise<void> = Promise.resolve();
  /** The bridge the shared session drives. It reads the lens receipt, lets an in-flight photo finish
   * before the preview is released, and starts a recording after any pending video binding. */
  const sessionCamera = {
    async startPreview(options: Parameters<typeof camera.startPreview>[0]) { const receipt = await camera.startPreview(options); previewReceipt = receipt; return receipt; },
    async stopPreview() {
      const writing = photoWrite;
      if (writing) await Promise.race([writing.then(() => {}, () => {}), new Promise(resolve => window.setTimeout(resolve, 10000))]);
      return camera.stopPreview();
    },
    async startRecording(options: Parameters<typeof camera.startRecording>[0]) { await modeChange; return camera.startRecording(options); },
    stopRecording: () => camera.stopRecording(),
  };
  /** Everything waiting for the preview (a queued agent capture or scan) resumes when a start settles. */
  const waiters = new Set<() => void>();
  function settle() { if (session.phase === 'starting') return; const ready = [...waiters]; waiters.clear(); for (const resume of ready) resume(); }
  function untilSettled(signal?: AbortSignal): Promise<void> {
    if (session.phase !== 'starting') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
      const abort = () => { waiters.delete(done); reject(signal?.reason); };
      waiters.add(done); signal?.addEventListener('abort', abort, { once: true });
    });
  }
  /** Set when the native size or duration limit stopped the recording. */
  let limitStop = false;
  const session=createCameraSession({
    camera:sessionCamera,active,available:()=>browserMode||Capacitor.isPluginAvailable('ElizaCamera'),
    preview:()=>({direction,resolution:{width:1280,height:720},mirror:direction==='front'}),
    recording:()=>({audio:true,saveToGallery:true,quality:'medium',maxDuration:300,maxFileSize:104857600}),
    hooks:{
      recordingFinishing(){api?.set({rec:false});},
      recordingSaved:adoptVideo,
      recordingFailed(){limitStop=false;if(!disposed)message('Video may not have saved. Check Photos.');},
      changed(){settle();schedule();},
    },
  });
  function hideAccess(){accessPanel?.remove();accessPanel=undefined;}
  function showAccess(kind:AccessKind|'unavailable'){
    hideAccess();
    const vf=document.querySelector<HTMLElement>(finder),screen=vf?.closest<HTMLElement>('[data-alpha-camera-root]')||vf?.closest<HTMLElement>('[data-alpha-layer]')||vf?.closest<HTMLElement>('[data-screen]');if(!screen)return;
    const label=kind==='unavailable'?'Camera unavailable':kind==='camera'?'Camera access is off':'Microphone access is off';
    const panel=document.createElement('div');panel.setAttribute('role','alert');panel.setAttribute('aria-label',label);panel.dataset.alphaCameraAccess=kind;
    panel.style.cssText='position:absolute;left:16px;right:16px;top:38%;z-index:50;padding:16px;border-radius:20px;background:#1c1c1e;color:#fff;font:inherit;display:flex;flex-direction:column;gap:12px;text-align:center';
    const title=document.createElement('strong');title.textContent=label;
    const actions=document.createElement('div');actions.style.cssText='display:flex;gap:8px;justify-content:center;flex-wrap:wrap';
    const action=(text:string,go:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.style.cssText='min-height:44px;padding:0 16px;border-radius:22px;background:rgba(255,255,255,.16);color:#fff;font:inherit';b.onclick=go;actions.append(b);return b;};
    if(!browserMode&&kind!=='unavailable')action('Open settings',()=>{void device.openSettings({page:'privacy'}).catch(()=>message('Settings could not open.'));});
    action('Try again',()=>{hideAccess();if(kind==='camera'||kind==='unavailable')void start(true);else{session.clearDenied('microphone');message('');}});
    panel.append(title,actions);
    screen.append(panel);accessPanel=panel;
  }
  let noticeTimer:number|undefined,noticeGeneration=0;
  /** One short line, only for an outcome the person has to act on. */
  const message = (value:string,persistent=false) => {
    window.clearTimeout(noticeTimer);noticeTimer=undefined;const generation=++noticeGeneration;
    api?.set({said:value});
    if(value&&!persistent)noticeTimer=window.setTimeout(()=>{noticeTimer=undefined;if(!disposed&&generation===noticeGeneration&&api?.get('camera').said===value)api.set({said:''});},5000);
  };
  /** The shutter flash: the only feedback a capture gives while it is written. */
  function shutterFlash(owner:Bag){owner.set({fl:1});window.setTimeout(()=>{if(!disposed)owner.set({fl:0});},90);}
  function adoptLens(receipt:unknown){lens=lensFromReceipt(receipt);zoomRatio=lens.zoom;flash=lens.flash;}
  /** The last-capture tile: one library row, read once the preview is ready. */
  async function loadLast(token:number){
    if(lastCapture||!libraryAvailable())return;
    try{
      const result=await library.list({limit:1});
      if(disposed||token!==session.token()||lastCapture)return;
      const row=result.items[0];if(!row)return;
      lastCapture=normalize(row);api?.set({nativeCaptureRevision:lastCapture.id});
    }catch{/* The tile stays empty; Photos reports library errors. */}
  }
  function bindMode(mode:string){
    if(session.phase!=='ready')return;
    const token=session.token(),wanted=mode==='video'?'video':'photo';
    modeChange=modeChange.then(async()=>{if(token!==session.token()||typeof camera.setCaptureMode!=='function')return;try{await camera.setCaptureMode({mode:wanted});}catch{/* startRecording binds video itself. */}});
  }
  async function stop() {
    // A scan review that opened a system picker stays open while Android covers the WebView.
    closeQuestion?.();closeQuestion=undefined;if(!systemPickerActive())cancelScan(); mask(false); hideAccess();
    await session.stop();
  }
  async function start(retry = false) {
    // Every start goes through the native layer, which checks camera access again: it may have changed in Android settings.
    const outcome=await session.start(retry);
    if(outcome.status==='ready'){hideAccess();adoptLens(previewReceipt);mask(true);api?.set({flash,nativeCameraPhase:'ready'});bindMode(api?.get('camera').mode);void loadLast(session.token());}
    else if(outcome.status==='denied'){mask(false);showAccess('camera');}
    else if(outcome.status==='unavailable'){mask(false);showAccess('unavailable');}
  }
  async function control<T>(task: () => Promise<T>, completed: (value:T) => void) {
    let value:T|undefined;
    const outcome=await session.control(async()=>{value=await task();});
    if(outcome==='done')completed(value as T);
    else if(outcome==='failed')message('Not supported on this camera.');
  }
  /** Tap to focus runs alongside everything else: it never holds a lock the shutter waits on. */
  function focusAt(x:number,y:number){
    if(session.phase!=='ready'||session.recordingStarting||session.finalizing)return;
    void camera.setFocusPoint({x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y))}).catch(()=>{/* Focus is best effort. */});
  }
  /** The session's recordingSaved hook: only a MediaStore (or browser) receipt read back from the library is kept. */
  async function adoptVideo(receipt:VideoReceipt) {
    const limitReached=limitStop;limitStop=false;
    if (!/^(content:\/\/media\/|browser-video:\/\/\/)/.test(receipt.path)) throw new Error('Incomplete recording');
    const id = receipt.path.split('/').pop();
    if (!id || !/^\d+$/.test(id)) throw new Error('Missing video identity');
    const item = normalize(await library.read({ id: 'v:' + id }));
    if (disposed) return;
    captures = [item, ...captures.filter(row => row.id !== item.id)]; loaded = false; lastCapture = item;
    api?.setView('photos', { nativeCaptureRevision: item.id });
    message(limitReached?'Maximum length reached. Video saved.':'');
  }
  const finishVideo=()=>session.finishRecording();
  async function record() {
    if (session.recording || session.finalizing) { await finishVideo(); return; }
    if (session.busy || session.phase !== 'ready') return;
    // A queued agent photo would otherwise wait for as long as this recording runs.
    if(agentRequest?.queued)agentRequest.refused=true;
    const outcome=await session.startRecording();
    if(outcome==='recording'){duration=0;api?.set({ rec: true });message('');}
    else if(outcome==='denied')showAccess('microphone');
    else if(outcome==='failed')message('Video didn’t start. Try again.');
    schedule();
  }
  async function saveCameraPhoto(owner:Bag,showSaved:boolean):Promise<SavedPhoto>{
    // The native layer writes the full JPEG straight to MediaStore (DCIM/Camera) and returns
    // its URI with a small thumbnail; no full-size image crosses the bridge.
    // With thumbnailOnly the native camera chooses the JPEG quality itself.
    const photo = await camera.capturePhoto(browserMode ? { format: 'jpeg', quality: 85, saveToGallery: true } : { format: 'jpeg', saveToGallery: true, thumbnailOnly: true });
    const preview = photo.thumbnail || photo.base64;
    // Android 9 and older (or a build without the patch) may answer with a file path: the photo is saved, without a MediaStore identity.
    const legacyFile = !browserMode && typeof photo.path === 'string' && /^file:\/\/\//.test(photo.path);
    const path = photoReceiptPath(photo.path, browserMode);
    if ((!path && !legacyFile) || photo.format !== 'jpeg' || !preview || photo.width <= 0 || photo.height <= 0) throw new Error('Incomplete photo receipt');
    // A capture may finish after navigation: the gallery write already happened.
    // Retain its real receipt, but never move the user back to Camera.
    const mediaId = path ? path.split('/').pop() : '';
    const item: SavedPhoto = { id: mediaId ? 'native-camera-' + mediaId : '', image: 'data:image/jpeg;base64,' + preview, width: photo.width, height: photo.height, date: Date.now(), revision: 'captured' };
    if (disposed) return item;
    lastCapture = item;
    if (item.id) captures = [item, ...captures.filter(row => row.id !== item.id)];
    loaded = false;
    if(showSaved)owner.setView('photos', { nativeCaptureRevision: item.id || Date.now() });
    else owner.set({nativeCaptureRevision:item.id || Date.now()});
    return item;
  }
  function writePhoto(owner:Bag,showSaved:boolean){
    const job=saveCameraPhoto(owner,showSaved);photoWrite=job;
    const clear=()=>{if(photoWrite===job)photoWrite=undefined;};
    job.then(clear,clear);
    return job;
  }
  async function capture() {
    if (session.phase !== 'ready') { if (session.phase !== 'starting') await start(true); return; }
    if (!api) return;
    if (api.get('camera').mode === 'video') { await record(); return; }
    cancelScan();
    const owner = api;
    await session.exclusive(async token=>{
      shutterFlash(owner);
      try { await writePhoto(owner,true); }
      catch { if (session.current(token)) message('Photo not saved. Try again.'); }
    });
  }
  /** An agent capture asked for while Camera starts waits for the preview, unless a recording starts first. */
  let agentRequest:{queued:boolean;refused:boolean}|undefined;
  const takeRequestedPhoto=async(operationId:string,signal:AbortSignal,current:()=>void):Promise<CameraCaptureAttempt>=>{
    const busy:CameraCaptureAttempt={status:'failed',summary:'Camera is busy. No photo was taken.'};
    let dispatched=false,request:{queued:boolean;refused:boolean}|undefined;
    try{
      signal.throwIfAborted();current();
      const owner=api;
      if(!cameraViewVisible()||!owner)return {status:'failed',summary:'Open Camera, then ask again. No photo was taken.'};
      if(agentRequest||session.busy)return busy;
      request=agentRequest={queued:false,refused:false};requestedCaptureActive=true;
      if(session.phase!=='ready'){
        request.queued=true;
        if(session.phase!=='starting')void start(true);
        await untilSettled(signal);
        request.queued=false;
      }
      // The request is checked again right before the shutter: the conversation or screen may have changed.
      signal.throwIfAborted();current();
      if(request.refused)return {status:'failed',summary:'Recording started, so no photo was taken.'};
      if(!active()||session.phase!=='ready')return {status:'failed',summary:session.phase==='off'?'Camera closed. No photo was taken.':'Camera unavailable. No photo was taken.'};
      const attempt=await session.exclusive(async():Promise<CameraCaptureAttempt>=>{
        dispatched=true;shutterFlash(owner);
        const item=await writePhoto(owner,false);
        if(!item.id)return {status:'unknown',summary:'Photo saved. Check Photos.'};
        const cameraResult=validateCameraCaptureResult({version:1,kind:'camera_capture_photo',operationId,mediaId:nativeId(item.id),width:item.width,height:item.height,mime:'image/jpeg'},operationId);
        return {status:'succeeded',summary:'Photo saved in Photos.',cameraResult};
      });
      return attempt.status==='busy'?busy:attempt.value;
    }catch{return {status:dispatched?'unknown':'failed',summary:dispatched?'The photo outcome is unconfirmed. Check Photos before taking another.':'The Camera request changed. No photo was taken.'};}
    finally{if(request&&agentRequest===request)agentRequest=undefined;if(request){requestedCaptureActive=false;schedule();}}
  };
  requestedPhoto=takeRequestedPhoto;
  /** The host Keep port of a scanned page: the browser's photo store, or the owned captures store with the capture's operation identity. */
  async function keepScan(photo:Photo,operationId:string,signal:AbortSignal,owner:Bag):Promise<CameraKeepOutcome>{
    if(!photo.base64)return {status:'failed',message:'Photo was not kept.'};
    if(browserMode){
      const row=await importBrowserPhoto({original:new File([],'scan.jpg',{type:'image/jpeg'}),image:'data:image/jpeg;base64,'+photo.base64,width:photo.width,height:photo.height},signal);
      captures=[normalize(row),...captures.filter(item=>nativeId(item.id)!==row.id)];loaded=false;lastCapture=normalize(row);owner.setView('photos',{nativeCaptureRevision:row.id});
      return {status:'saved',id:row.id,message:'Kept in Photos.'};
    }
    const result=await library.keepCapture({dataBase64:photo.base64,operationId});
    if(result.status!=='saved'||!result.id)return {status:'failed',message:result.message||'Photo was not kept.'};
    // Saved even if the review closed meanwhile: Photos shows the kept page.
    loaded=false;owner.setView('photos',{nativeCaptureRevision:'native-camera-'+result.id});return {status:'saved',id:result.id,message:'Kept in Photos.'};
  }
  /** Scanning is not a camera mode: asking Alpha to scan while Camera is open captures one
   * frame, kept in memory, into scan review. Photos receives it only through Keep photo. */
  let scanning=false;
  async function scanFrame(owner:Bag){
    if(scanning||session.busy){message('Camera is busy. Try again.');return;}
    scanning=true;requestedCaptureActive=true;cancelScan();
    try{
      if(session.phase!=='ready'){if(session.phase!=='starting')void start(true);await untilSettled();}
      if(session.phase!=='ready'||!active())return;
      await session.exclusive(async token=>{
        try{
          const photo=await camera.capturePhoto({format:'jpeg',quality:85,saveToGallery:false});
          if(photo.format!=='jpeg'||!photo.base64||photo.width<=0||photo.height<=0)throw new Error('Incomplete photo receipt');
          if(disposed||!session.current(token))return;
          const bytes=Uint8Array.from(atob(photo.base64),char=>char.charCodeAt(0));
          const scan=createScanCapture({...photo,base64:photo.base64},'unsaved',(page,operationId,signal)=>keepScan(page,operationId,signal,owner));
          const closeReview=openScanReview(new Blob([bytes],{type:'image/jpeg'}),(text,id)=>owner.saveScannedNote?.(text,id)??Promise.resolve(false),draft=>{if(disposed||!active())return false;return owner.reviewScannedCalendarDraft?.(draft)??false;},'unsaved',async()=>{const outcome=await scan.keep();if(outcome?.status==='saved')return outcome.message||'Kept in Photos.';
            // No outcome: a Keep is already running or the review closed; nothing to retry from here.
            if(!outcome)throw new ScanKeepError('Keep photo unconfirmed. Check Photos before keeping it again.',false);
            // A definite failure kept nothing (the next Keep is a new identity). An unknown native outcome is
            // retried under the same operation identity, which the owned captures store resolves once. The
            // browser photo store has no operation identity, so an unknown outcome there is not retried.
            if(outcome.status==='failed')throw new ScanKeepError((outcome.message||'Photo was not kept.')+' Nothing was saved.',true);
            throw new ScanKeepError(browserMode?'Keep photo unconfirmed. Check Photos before keeping it again.':'Keep photo unconfirmed. Trying again checks the same photo and does not save a second copy.',!browserMode);});
          closeScan=()=>{scan.close();closeReview();};
        }catch{if(session.current(token))message('Page not captured. Try again.');}
      });
    }finally{scanning=false;requestedCaptureActive=false;schedule();}
  }
  scanRequest=()=>{
    const owner=api;if(disposed||!owner||!cameraViewVisible())return false;
    // Close the chat so the viewfinder and scan review are visible.
    if(owner.S.chat!=='hidden')owner.shell({chat:'hidden'});
    void scanFrame(owner);return true;
  };
  function askCameraFrame(owner:Bag):boolean{
    if(session.recording||session.recordingStarting||session.finalizing||session.capturing||session.phase!=='ready')return false;
    closeQuestion?.();const token=session.token();
    closeQuestion=reviewContentQuestion({name:'Camera frame',text:'',current:()=>session.current(token),compose:draft=>owner.composeContentQuestion(draft),image:async signal=>{const photo=await camera.capturePhoto({format:'jpeg',quality:85,saveToGallery:false});signal.throwIfAborted();if(!photo.base64)throw Error('Camera frame unavailable.');return new Blob([Uint8Array.from(atob(photo.base64),char=>char.charCodeAt(0))],{type:'image/jpeg'});}});
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
  const ZOOM_ON='background-color:var(--alpha-white);color:var(--alpha-black);width:40px;height:40px;padding:2px;box-sizing:content-box;background-clip:content-box;font-size:13px';
  const ZOOM_OFF='background-color:rgba(0,0,0,.65);color:var(--alpha-white);width:34px;height:34px;padding:5px;box-sizing:content-box;background-clip:content-box;font-size:12px';
  module.render = (st: Bag, currentApi: Bag) => {
    api = currentApi;
    const data = render(st, currentApi);
    const ready = session.phase === 'ready', recordingBusy = session.recording || session.recordingStarting || session.finalizing;
    // The viewfinder stays black until the first real frame, then fades to the preview.
    data.bg = 'transparent'; data.vfBg = ready ? 'transparent' : '#000000'; data.vfOp = 1;
    data.zoomCss = ''; data.rec = session.recording; data.recTime = `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}`;
    data.shutter = () => { void capture(); };
    data.flip = () => {
      const next = direction === 'back' ? 'front' : 'back';
      // Flash and zoom return to their defaults before the lens changes, so the new lens never inherits a setting it lacks.
      void control(async () => { flash = false; zoomRatio = 1; currentApi.set({ flash: false }); return camera.switchCamera({ direction: next }); }, receipt => { direction = next; adoptLens(receipt); currentApi.set({ front: next === 'front', flash }); });
    };
    data.flashAvailable = ready && (browserMode ? browserCamera.flashAvailable() : lens.hasFlash);
    if (browserMode) data.flashLabel = browserCamera.lightingLabel(flash);
    data.toggleFlash = () => { const next = !flash; void control(() => camera.setSettings({ settings: { flash: next ? 'on' : 'off' } }), () => { flash = next; currentApi.set({ flash: next }); }); };
    const stops = ready ? zoomStops(lens) : [];
    data.showZoom = !recordingBusy && stops.length > 1;
    data.zooms = stops.map(([ratio, label]) => ({ label, aria: `Zoom ${label.replace('×', '')}x`, css: Math.abs(ratio - zoomRatio) < 1e-3 ? ZOOM_ON : ZOOM_OFF, pick: () => { void control(() => camera.setZoom({ zoom: ratio }), () => { zoomRatio = ratio; currentApi.set({ nativeZoom: ratio }); }); } }));
    data.vfUp = (event: PointerEvent) => { const bounds = document.querySelector(finder)?.getBoundingClientRect(); focusAt((event.clientX - (bounds?.left ?? 0)) / (bounds?.width || window.innerWidth), (event.clientY - (bounds?.top ?? 0)) / (bounds?.height || window.innerHeight)); };
    data.showModes = !recordingBusy;
    data.modes = (data.modes || []).map((m: Bag) => ({ ...m, pick: () => { if (recordingBusy || session.capturing) return; const mode = m.label.toLowerCase(); if (mode === 'photo' || mode === 'video') { if (currentApi.get('camera').mode !== mode) bindMode(mode); currentApi.set({ mode, rec: false }); } } }));
    const last = lastCapture;
    data.lastLabel = last?.kind === 'video' ? 'Open last video' : 'Open last photo';
    if (last) {
      data.hasLast = true; data.noLast = false; data.lastBg = `url("${last.image}") center / cover no-repeat`; data.lastTf = ''; data.lastFlt = '';
      data.openLast = () => { currentApi.open('photos', { tab: 'lib', album: null, open: last.id || null, chrome: true, nativePhotoSelection: null }); };
    } else { data.hasLast = false; data.noLast = true; data.openLast = () => {}; }
    return data;
  };
  const cameraActions = module.actions;
  module.actions = { ...(cameraActions || {}), scan: () => { if (api) void scanFrame(api); } };
  module.back = () => { if (session.recording || session.recordingStarting || session.finalizing) { void stop(); return true; } return false; };
  module.onLeave = () => { void stop(); };
  /** Pinch on the grid: 4 columns by default, 3 or 5 when pinched. Wheel-free; two touches only. */
  /** The Library grid's scroll position and size: only the rows on screen are rendered. */
  let gridEl:HTMLElement|undefined,gridView={scrollTop:0,viewport:0,width:0,header:40,key:''};
  const GRID_GAP=2,GRID_TOP=12,GRID_OVERSCAN=3;
  function gridMetrics(){
    const width=gridView.width||Math.min(window.innerWidth||400,480),viewport=gridView.viewport||window.innerHeight||800;
    return {columns:gridColumns,width,gap:GRID_GAP,header:gridView.header,scrollTop:Math.max(0,gridView.scrollTop-GRID_TOP),viewport,overscan:GRID_OVERSCAN};
  }
  function measureGrid(el:HTMLElement,owner:Bag){
    const header=el.querySelector<HTMLElement>('.photo-day-header')?.offsetHeight;
    gridView={...gridView,scrollTop:el.scrollTop,viewport:el.clientHeight,width:el.clientWidth,header:header&&header>0?header:gridView.header};
    // Re-render only when the set of rendered rows changes (row-sized steps), not on every pixel.
    const pitch=(gridView.width-GRID_GAP*(gridColumns-1))/gridColumns+GRID_GAP,key=[gridColumns,Math.floor(gridView.scrollTop/Math.max(1,pitch)),Math.round(gridView.viewport/Math.max(1,pitch)),gridView.width,gridView.header].join(':');
    if(key!==gridView.key){gridView.key=key;owner.set({nativeGridWindow:key});}
  }
  function attachGrid(el:HTMLElement|null,owner:Bag){
    if(el&&el!==gridEl){gridEl=el;queueMicrotask(()=>{if(gridEl===el&&el.isConnected)measureGrid(el,owner);});}
    if(!el||el.dataset.alphaPhotosGrid)return;el.dataset.alphaPhotosGrid='1';
    if(typeof ResizeObserver==='function')new ResizeObserver(()=>{if(el.isConnected)measureGrid(el,owner);}).observe(el);
    let start=0,startColumns=gridColumns;
    const distance=(touches:TouchList)=>Math.hypot(touches[0].clientX-touches[1].clientX,touches[0].clientY-touches[1].clientY);
    el.addEventListener('touchstart',event=>{if(event.touches.length===2){start=distance(event.touches);startColumns=gridColumns;}},{passive:true});
    el.addEventListener('touchmove',event=>{if(event.touches.length!==2||!start)return;const columns=pinchColumns(startColumns,start,distance(event.touches));if(columns!==gridColumns){gridColumns=columns;owner.set({nativeGridColumns:columns});}},{passive:true});
    el.addEventListener('touchend',event=>{if(event.touches.length<2)start=0;},{passive:true});
    // Newest-first paging: the next page loads as the end of the grid comes into view.
    el.addEventListener('scroll',()=>{measureGrid(el,owner);const album=owner.get('photos')?.album;if(el.scrollTop+el.clientHeight<el.scrollHeight-900)return;
      if(album==='trash'){if(trashNext&&!trashLoading)void loadTrash(owner,true);}else if(album){if(albumNext&&!albumBusy)void loadAlbum(album,owner,true);}else if(next&&!loading)void refresh(true);},{passive:true});
  }
  const gridCss=()=>`grid-template-columns:repeat(${gridColumns},minmax(0,1fr))`;
  const durationLabel=(row:SavedPhoto)=>row.kind==='video'&&row.duration?`${Math.floor(row.duration/60)}:${String(Math.floor(row.duration%60)).padStart(2,'0')}`:'';
  const tileLabel=(row:SavedPhoto)=>{const when=viewerTitle(shotAt(row));return `${row.kind==='video'?'Video':'Photo'}, ${when.day} ${when.time}`;};
  const imageCss=(row:SavedPhoto)=>row.image?`url("${row.image}") center / cover no-repeat`:'var(--s2)';
  function tiles(rows:SavedPhoto[],owner:Bag,trashMode=false,order:SavedPhoto[]=rows){
    const now=Date.now();
    return rows.map(row=>{const left=trashMode?daysLeft(row.expiresAt,now):undefined;return {nativeMediaId:row.id,bg:imageCss(row),tf:'',flt:'',vid:row.kind==='video',dur:durationLabel(row),fav:!trashMode&&!!row.favorite&&!selection,left:left===undefined?'':`${left}d`,dim:mutating?'opacity:.35;pointer-events:none':'',alt:tileLabel(row)+(left!==undefined?`, ${left} ${left===1?'day':'days'} left`:''),...thumbnailEvents(row,owner,order)};});
  }
  /** The agent asked to filter, select or create an album: it acts on the Library the owner sees. */
  const host={
    visible:()=>!disposed&&!document.hidden&&!!photosApi?.isActive(),
    reviewOpen:()=>!!albumReview||!!shareReview,
    reviewChanged:()=>{photosApi?.set({nativeAgentReview:Date.now()});const note=deviceLibrary.takeStatus();if(note&&photosApi?.isActive())photosApi.toast(note);},
    trashed:(ids:string[])=>{const owner=photosApi;if(!owner||!ids.length)return;void (async()=>{await loadTrash(owner);await refresh();const rows=trash.filter(row=>ids.includes(nativeId(row.id)));if(owner.isActive())owner.toast(`${ids.length} moved to Recently deleted`,rows.length?{undo:()=>{void changeSelection(owner,'restore',rows);}}:undefined);})();},
    async run(operation:HostOperation,signal:AbortSignal):Promise<LibraryAgentResult|PhotosViewResult>{
      const owner=photosApi;if(!owner?.isActive()||disposed)throw new LibraryAgentRefusal('Open Photos, then ask again.');
      if(edit||closeVideoEdit||mutating||sharing)throw new LibraryAgentRefusal('Photos is busy. Try again.');
      if(!loaded)await refresh();signal.throwIfAborted();
      if(operation.type==='photos_filter'){
        const {type:_type,...wanted}=operation;void _type;
        const albumName=(key:string)=>customAlbums.find(row=>'custom:'+row.id===key)?.name;
        photosFilter={...wanted,label:filterLabel(wanted,albumName)};
        // The filter never changes media; the selection keeps only rows it still shows.
        if(selection)selection=selection.filter(row=>filterMatches(row,photosFilter,albumMembers));
        owner.set({tab:'lib',album:null,open:null,nativePhotoSelection:null,nativePhotosFilter:Date.now()});
        const shown=captures.filter(row=>filterMatches(row,photosFilter,albumMembers)).length;
        return {kind:'photos_filter',shown,more:!!next};
      }
      if(operation.type==='photos_open'){
        // Opening is navigation only: the viewer shows the item; nothing changes or is shared.
        const row=captures.find(item=>nativeId(item.id)===operation.id);
        if(!row)return {kind:'photos_open',opened:false};
        selection=undefined;selectionTab=undefined;photosFilter=undefined;
        owner.set({tab:'lib',album:null,sheet:null,chrome:true,nativeMultiSelection:Date.now()});
        await openSaved(row.id,owner);
        return {kind:'photos_open',opened:owner.get('photos').open===row.id};
      }
      const wanted=new Set(operation.ids),rows=captures.filter(row=>wanted.has(nativeId(row.id)));
      if(operation.type==='photo_library_select'){
        selection=rows;selectionTab='lib';photosFilter=undefined;
        owner.set({tab:'lib',album:null,open:null,nativePhotoSelection:null,nativeMultiSelection:Date.now()});
        return {kind:'photo_library_select',selected:rows.length,missing:operation.ids.length-rows.length};
      }
      if(!rows.length)throw new LibraryAgentRefusal('Those items are not in Photos. Nothing changed.');
      if(albumReview||shareReview)throw new LibraryAgentRefusal('Finish the open review first.');
      if(operation.type==='photos_share'){
        // Reviewed: the owner confirms over the grid, then picks a target in Android's share sheet.
        shareReview={items:rows.map(row=>({...row})),missing:operation.ids.length-rows.length};
        owner.set({tab:'lib',album:null,open:null,nativeAgentReview:Date.now()});
        return {kind:'photos_share',status:'review_opened',count:rows.length,missing:operation.ids.length-rows.length};
      }
      albumReview={name:operation.name,items:rows.map(row=>({...row})),missing:operation.ids.length-rows.length};
      owner.set({tab:'lib',album:null,open:null,nativeAgentReview:Date.now()});
      return {kind:'photos_album_create',status:'review_opened',count:rows.length,missing:operation.ids.length-rows.length};
    },
  };
  const releaseHost=setMainLibraryHost(host);
  /** photos_share after the owner confirmed: the exact reviewed rows, at the reviewed revisions. */
  async function confirmShareReview(owner:Bag){
    const pending=shareReview;if(!pending||sharing||mutating)return;
    sharing=true;owner.set({nativeAgentReview:Date.now()});
    try{
      const items=pending.items.map(row=>({id:nativeId(row.id),revision:row.mutationRevision||''})),token=photoReadEpoch;
      const result:{status:string;message?:string}=browserMode?await browserPhotoLibrary.shareMany({items},()=>!disposed&&!document.hidden&&photoReadEpoch===token&&owner.isActive()):await nativeLibrary.shareMany({items});
      if(result.status!=='opened'&&owner.isActive())owner.toast(result.message||'Sharing could not open.');
    }catch(error){if(owner.isActive()&&!(error instanceof DOMException&&error.name==='AbortError'))owner.toast('An item changed. Nothing was shared; ask again.');}
    finally{if(shareReview===pending)shareReview=undefined;sharing=false;if(!disposed)owner.set({nativeAgentReview:Date.now()});}
  }
  async function confirmAlbumReview(owner:Bag){
    const pending=albumReview;if(!pending||mutating)return;
    mutating=true;owner.set({nativeAgentReview:Date.now()});
    try{
      const [first,...rest]=pending.items,created=await library.changeAlbum({operation:'create',name:pending.name,mediaId:nativeId(first.id),mediaRevision:first.mutationRevision});
      const result=await addMembers({id:created.id,revision:created.revision},rest);
      if(owner.isActive())owner.toast(`Created “${pending.name.trim()}”`+(result.skipped?` · ${result.skipped} changed and not added`:''));
    }catch{if(owner.isActive())owner.toast('Album not created. An item changed; ask again.');}
    finally{if(albumReview===pending)albumReview=undefined;mutating=false;albumKey='';++albumEpoch;if(!disposed){void loadCustomAlbums(owner);owner.set({nativeAgentReview:Date.now()});}}
  }
  if (photosRender) views.photos.render = (st: Bag, currentApi: Bag) => {
    photosApi = currentApi;
    // Read canonical intent once per Photos entry, without replaying a save.
    if(currentApi.isActive()&&!edit&&!editRecoveryChecked){
      editRecoveryChecked=true;const token=editEpoch;
      queueMicrotask(()=>{void readMediaCopyIntent().then(pending=>{if(!disposed&&currentApi.isActive()&&editEpoch===token&&pending&&automaticEditRecovery!==pending.token){automaticEditRecovery=pending.token;void recoverEdit(currentApi);}}).catch(()=>{if(!disposed&&currentApi.isActive()&&editEpoch===token){currentApi.set({nativeCopyRecovery:true});currentApi.toast('Saved-copy request needs recovery. No edit was repeated.');}});});
    }
    if (!loaded && !loading) queueMicrotask(() => { void refresh(); });
    const data = photosRender(st, currentApi);data.normalSelecting=true;if(data.v)data.v.notDeleted=true;
    const onAlbums=st.tab==='alb'&&!st.album;
    // Header: "Photos" / "Albums" with text tabs; Select in the Library and in albums.
    data.tabs=(data.tabs||[]).map((tab:Bag)=>({...tab,pick:()=>{if(mutating||sharing)return;selection=undefined;selectionTab=undefined;drag=undefined;currentApi.set({nativeMultiSelection:Date.now()});tab.pick?.();}}));
    data.libTab=!onAlbums&&!selection;
    // Access: one row while access is partial or denied; nothing once it is full.
    data.libraryAccessControl=!browserMode&&!!libraryAccess&&libraryAccess.scope!=='full'&&!st.open&&!st.album&&!selection&&!onAlbums;
    data.libraryAccessBusy=requestingLibraryAccess;
    data.libraryAccessChoose=async()=>{if(requestingLibraryAccess)return;requestingLibraryAccess=true;currentApi.set({nativeLibraryAccessRevision:Date.now()});const before=libraryAccess?.scope;try{libraryAccess=await nativeLibrary.requestLibraryAccess();if(libraryAccess.scope===before&&before==='denied')await nativeLibrary.openLibrarySettings();loaded=false;await refresh();}catch{currentApi.toast('Photo access could not open.');}finally{requestingLibraryAccess=false;currentApi.set({nativeLibraryAccessRevision:Date.now()});}};
    data.copyRecovery=browserMode&&!!st.nativeCopyRecovery;data.openCopyRecovery=()=>void openCopyRecovery(currentApi);
    if (!trashLoaded && !trashLoading && !st.nativeTrashError && libraryAvailable()) queueMicrotask(() => { void loadTrash(currentApi); });
    if (!counts && !countsBusy && !countsError && libraryAvailable()) queueMicrotask(() => { void loadCounts(currentApi); });
    if(!albumsLoaded&&!albumsBusy)queueMicrotask(()=>{void loadCustomAlbums(currentApi);});
    data.trashN = counts ? String(counts.trash) : trashLoaded ? String(trash.length) + (trashNext ? '+' : '') : '';
    // Albums: Favorites, Videos, Camera, Screenshots, then custom albums with covers.
    const cover=(rows:SavedPhoto[])=>rows[0]?.image?`url("${rows[0].image}") center / cover no-repeat`:'var(--s2)';
    const openAlbum=(key:string)=>{currentApi.set({album:key,open:null,nativePhotoSelection:null});closeVideo();void loadAlbum(key,currentApi);};
    const builtIn:[string,string,string,number|undefined][]=[['fav','Favorites','favorites',counts?.favorites],['video','Videos','videos',counts?.videos],['camera','Camera','camera',counts?.camera],['shot','Screenshots','screenshots',counts?.screenshots]];
    data.tiles=builtIn.filter(([key,,,count])=>key==='fav'||count===undefined&&captures.some(row=>albumOf(row,ALBUM_KEYS[key]))||!!count).map(([key,name,album,count])=>({name,count:count??'',bg:cover(captures.filter(row=>albumOf(row,album))),tf:'',flt:'',open:()=>openAlbum(key)}));
    data.tiles.push(...customAlbums.map(album=>({name:album.name,count:album.count,bg:cover(captures.filter(row=>album.memberIds.includes(nativeId(row.id)))),tf:'',flt:'',open:()=>{openAlbum('custom:'+album.id);void loadCustomAlbums(currentApi);}})));
    data.hasPeople=false;
    data.albumsError=albumsRecovery?String(st.nativeAlbumsError||'Albums could not be read.'):'';data.albumsRecover=()=>{void import('../browser/preference-recovery').then(m=>m.openAlbumRecovery()).catch(()=>currentApi.toast('Album recovery could not open.'));};
    data.albumBackLabel='Back to albums';data.selectionBusy=mutating||sharing;
    data.albumManager=st.sheet==='owned-album'&&!!manager;
    if(manager){const selectedManager=manager,many=manager.items;data.am={modalRef:albumModal.ref,title:manager.confirmDelete?'Delete album?':manager.creating?'New album':manager.album?'Manage album':'Add to album',name:manager.name,onName:(event:Event)=>{if(manager){manager.name=(event.target as HTMLInputElement).value;currentApi.set({nativeAlbumDraft:Date.now()});}},
      managing:!!manager.album,naming:!!manager.creating||!!manager.album&&!manager.confirmDelete,info:false,description:'',choose:()=>{},choosing:(!!manager.media||!!many)&&!manager.creating,confirming:!!manager.confirmDelete,error:st.nativeAlbumsError||'',busy:mutating,
      items:customAlbums.map(album=>{const member=!many&&album.memberIds.includes(nativeId(manager?.media?.id||''));return {name:album.name,label:(member?'Remove from ':'Add to ')+album.name,go:()=>{void mutateAlbum(currentApi,member?'remove':'add',album);}};}),
      create:()=>{if(manager){manager.creating=true;manager.name='';currentApi.set({nativeAlbumDraft:Date.now()});}},save:()=>{void mutateAlbum(currentApi,selectedManager.creating?'create':'rename');},askDelete:()=>{if(manager){manager.confirmDelete=true;currentApi.set({nativeAlbumDraft:Date.now()});}},delete:()=>{void mutateAlbum(currentApi,'delete');},close:()=>{manager=undefined;currentApi.set({sheet:null});}};}
    data.selStart=()=>startSelection(currentApi);
    if(selection){
      const pool=selectionPool(currentApi),all=pool.length>0&&pool.every(row=>selection!.some(item=>item.id===row.id));
      data.hdr=false;data.selecting=true;data.selN=selection.length?`${selection.length} selected`:'Select items';data.selNone=!selection.length;
      data.selAllLabel=all?'Deselect all':'Select all';data.selAll=()=>{if(mutating||sharing||!selection)return;selection=all?[]:pool.slice();currentApi.set({nativeMultiSelection:Date.now()});};
      data.selectionDisabled=!selection.length||mutating||sharing;data.selDim=!selection.length||sharing||mutating?'opacity:.35;pointer-events:none':'';data.selCancel=()=>cancelPhotoSelection(currentApi);
      data.trashSelecting=st.album==='trash';data.normalSelecting=st.album!=='trash';data.trashCanDelete=true;
      data.selFavLabel=favoriteTarget(selection)?'Favorite':'Unfavorite';
      data.selRecover=()=>{void changeSelection(currentApi,'restore');};data.selDeleteForever=()=>{if(selection?.length)void preparePermanent(currentApi,selection);};data.selShare=()=>{void shareSelection(currentApi);};
      data.selSaveLocally=browserMode?()=>{const chosen=selection||[],token=photoReadEpoch;return saveBrowserMedia({items:chosen.map(row=>({id:nativeId(row.id),revision:row.mutationRevision||''}))},()=>!disposed&&!document.hidden&&photoReadEpoch===token&&currentApi.isActive()&&selection===chosen&&chosen.every(sameCapture));}:undefined;
      data.selFav=()=>{void changeSelection(currentApi,'favorite');};data.selDel=()=>{void changeSelection(currentApi,'trash');};
      data.selAlbum=(event:Event)=>{if(!selection?.length||mutating)return;albumTrigger=event.currentTarget as HTMLElement;manager={items:selection.slice(),name:'',choosing:true};currentApi.set({sheet:'owned-album'});void loadCustomAlbums(currentApi);};
    }
    data.mutationBusy = mutating;
    data.emptyOpen = st.sheet==='empty' && !!prepared;
    data.trashCount = prepared ? `${prepared.count} ${prepared.count===1?'item':'items'}` : '';
    const priorCloseSheet = data.closeSheet; data.closeSheet=()=>{if(st.sheet==='empty')cancelPermanent(currentApi);else if(st.sheet==='owned-album'){manager=undefined;currentApi.set({sheet:null});}else if(st.sheet==='photo-info')currentApi.set({sheet:null});else priorCloseSheet?.();};
    data.openTrash = () => { currentApi.set({ album: 'trash', open: null, nativePhotoSelection: null }); closeVideo(); void loadTrash(currentApi); };
    data.emptyNow = () => { void deletePermanent(currentApi); };
    data.trashAsk = () => { void preparePermanent(currentApi); };
    data.gridRef=(el:HTMLElement|null)=>attachGrid(el,currentApi);data.gridCss=gridCss();
    if (st.album === 'trash') {
      data.album = true; data.viewing = false; data.viewEmpty = false;
      data.albumBackLabel=selection?'Cancel selection':'Back to albums';
      data.alb = {canSelect:!selection&&trash.length>0,select:()=>startSelection(currentApi),title: selection?(selection.length?`${selection.length} selected`:'Select items'):'Recently deleted', isTrash: true, canEmpty: !permittedLibrary()&&!selection&&trash.length>0, notTrash: false, count: '', empty: trashLoaded&&!trash.length,
        close: () => {if(mutating||sharing)return;if(selection)cancelPhotoSelection(currentApi);else currentApi.set({album:null});}, emptyTrash: () => { void preparePermanent(currentApi); },
        status: st.nativeTrashError || st.nativeTrashMutationStatus || '', more: !!st.nativeTrashError, moreLabel: 'Retry', loadMore: () => { void loadTrash(currentApi); },
        items: tiles(trash,currentApi,true) };
    }
    if (st.album && st.album !== 'trash') {
      if(albumKey !== st.album){albumRows=[];albumNext='';queueMicrotask(()=>{void loadAlbum(st.album,currentApi);});}
      const custom=customAlbums.find(row=>'custom:'+row.id===st.album),names:Record<string,string>={fav:'Favorites',video:'Videos',camera:'Camera',shot:'Screenshots'};
      data.album=true;data.alb={title:selection?(selection.length?`${selection.length} selected`:'Select items'):custom?.name||names[st.album]||'Album',isCustom:!!custom&&!selection,canSelect:!selection&&albumRows.length>0,select:()=>startSelection(currentApi),manage:(event:Event)=>{if(custom)openAlbumManager(currentApi,undefined,custom,event.currentTarget as HTMLElement);},isTrash:false,notTrash:true,count:'',empty:!albumBusy&&!albumRows.length,
        close:()=>{if(selection)cancelPhotoSelection(currentApi);else currentApi.set({album:null});},status:st.nativeAlbumError||'',more:!!st.nativeAlbumError,moreLabel:'Retry',loadMore:()=>{void loadAlbum(st.album,currentApi);},
        items:tiles(albumRows,currentApi)};
    }
    data.libraryLoading = (!loaded || loading) && !captures.length;
    data.libraryMore = false;
    data.libraryError = st.nativeLibraryError || '';
    data.libraryRetry = () => { void refresh(); };
    // Library: newest first, grouped by day (Today, Yesterday, weekday dates), then by month.
    const shownCaptures = st.filter ? [] : captures.filter(row=>filterMatches(row,photosFilter,albumMembers));
    if (photosFilter) { data.hasFilter = true; data.filterLabel = photosFilter.label; data.filterN = String(shownCaptures.length) + (next ? '+' : ''); data.clearFilter = () => { photosFilter = undefined; currentApi.set({ nativePhotosFilter: Date.now() }); }; }
    // Drag ranges follow the whole visible grid, across day headers.
    // Virtualised: sections off screen become one spacer each side; on-screen sections render only
    // their visible rows, with padding for the rest, so the sticky day header stays in its section.
    const grouped = groupSections(shownCaptures), grid = virtualGrid(grouped.map(group => group.items.length), gridMetrics());
    const sections = grid.sections.map(part => { const group = grouped[part.index]; return { label: group.label, place: '', count: String(group.items.length), pad: `padding-top:${part.padTop}px;padding-bottom:${part.padBottom}px`, items: tiles(group.items.slice(part.from, part.to), currentApi, false, shownCaptures) }; });
    data.gridBefore = `height:${grid.before}px`; data.gridAfter = `height:${grid.after}px`;
    data.groups = [...sections, ...(data.groups || [])];
    const nothing = !data.groups.length && loaded && !loading && !st.nativeLibraryError;
    data.empty = nothing && !photosFilter; data.noMatches = nothing && !!photosFilter;
    // An agent review (photo_library_review or photos_album_create) waits over the grid.
    const review = deviceLibrary.reviewCard();
    data.agentReview = review ? { title: review.title, detail: review.detail, confirmLabel: 'Continue', busy: review.busy, confirm: review.confirm, cancel: review.cancel }
      : shareReview ? { title: `Share ${shareReview.items.length} ${shareReview.items.length === 1 ? 'item' : 'items'}?`, detail: '', confirmLabel: 'Share', busy: sharing, confirm: () => { void confirmShareReview(currentApi); }, cancel: () => { shareReview = undefined; currentApi.set({ nativeAgentReview: Date.now() }); } }
      : albumReview ? { title: `Create album “${albumReview.name.trim()}”?`, detail: `${albumReview.items.length} ${albumReview.items.length === 1 ? 'item' : 'items'}`, confirmLabel: 'Create', busy: mutating, confirm: () => { void confirmAlbumReview(currentApi); }, cancel: () => { albumReview = undefined; currentApi.set({ nativeAgentReview: Date.now() }); } } : null;
    const sequence = st.album === 'trash' ? trash : st.album ? albumRows : shownCaptures;
    const selected = preview?.id === st.open ? preview : [...captures, ...albumRows, ...trash].find(c => c.id === st.open);
    if (selected) {
      if (!st.nativePhotoSelection && preview?.id !== st.open) queueMicrotask(() => { if (currentApi.get('photos').open === selected.id) void openSaved(selected.id, currentApi); });
      const index = sequence.findIndex(row => row.id === selected.id);
      const go = (step: number) => { const target = sequence[index + step]; if (index < 0 || !target) return; void openSaved(target.id, currentApi); };
      let gesture: { x: number; y: number } | undefined, swiped = false;
      const when = viewerTitle(shotAt(selected)), chrome = st.chrome !== false;
      data.viewing = true; data.viewEmpty = false; data.editing = !!edit&&edit.source===selected.id;
      data.v = { bg: imageCss(selected).replace('cover', 'contain'), tf: '', flt: '', slide: '', day: when.day, sub: when.time, chromeOp: chrome ? 1 : 0, chromePE: chrome ? 'auto' : 'none', favIcon: selected.favorite ? 'fill:currentColor' : 'fill:none', favLabel: selected.favorite ? 'Remove from favorites' : 'Favorite', vid: selected.kind === 'video', playing: !!video && !video.paused, playBtn: selected.kind === 'video' && (!video || video.paused), prog: `width:${video?.duration ? Math.min(100, video.currentTime / video.duration * 100) : 0}%`, play: () => { void playVideo(selected, currentApi); }, pause: () => { video?.pause(); currentApi.set({ nativePlaybackRevision: Date.now() }); }, notSecure: true,
        // Tap shows or hides the controls; a horizontal swipe moves to the neighbouring item.
        tap: () => { if (swiped) { swiped = false; return; } currentApi.set({ chrome: !chrome }); },
        down: (event: PointerEvent) => { gesture = { x: event.clientX, y: event.clientY }; swiped = false; },
        up: (event: PointerEvent) => { const start = gesture; gesture = undefined; if (!start) return; const dx = event.clientX - start.x, dy = event.clientY - start.y; if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) { swiped = true; go(dx < 0 ? 1 : -1); } },
        hasPrev: index > 0, hasNext: index >= 0 && index < sequence.length - 1, prev: () => go(-1), next: () => go(1),
        share: async () => {
        if(sharing || mutating)return;
        sharing=true;
        try { const input={id:nativeId(selected.id),revision:selected.mutationRevision},token=photoReadEpoch,current=()=>!disposed&&!document.hidden&&photoReadEpoch===token&&currentApi.isActive()&&currentApi.get('photos').open===selected.id&&sameCapture(selected),result:Awaited<ReturnType<typeof nativeLibrary.share>>=browserMode?await browserPhotoLibrary.share(input,current):await nativeLibrary.share(input); if(result.status!=='opened')currentApi.toast(result.message||'Sharing could not open.'); }
        catch(error) { if(!(browserMode&&error instanceof DOMException&&error.name==='AbortError'))currentApi.toast(browserMode&&error instanceof Error?error.message:'This photo is no longer available for sharing.'); }
        finally { sharing=false; }
      }, fav: () => { void favorite(selected,currentApi); }, edit: () => {void beginEdit(selected,currentApi);}, del: () => { void changeTrash(selected, true, currentApi, (sequence[index + 1] || sequence[index - 1])?.id); }, info: () => { currentApi.set({ sheet: 'photo-info', chrome: true }); }, ask: () => { askCapture(selected,currentApi); } };
      data.v.saveLocally=browserMode?()=>{const token=photoReadEpoch;return saveBrowserMedia({items:[{id:nativeId(selected.id),revision:selected.mutationRevision||''}]},()=>!disposed&&!document.hidden&&photoReadEpoch===token&&currentApi.isActive()&&currentApi.get('photos').open===selected.id&&sameCapture(selected));}:undefined;
      data.v.isDeleted=!!selected.trashed;data.v.notDeleted=!selected.trashed;data.v.canDeleteForever=!!selected.trashed;data.v.recover=()=>void changeTrash(selected,false,currentApi);data.v.deleteForever=()=>void preparePermanent(currentApi,[selected]);if(selected.trashed){data.v.notSecure=false;const left=daysLeft(selected.expiresAt);data.v.sub=left===undefined?when.time:`${left} ${left===1?'day':'days'} left`;}
      data.v.viewerLabel=`${selected.kind==='video'?'Video':'Photo'}. Tap to show or hide controls, swipe to browse`;data.v.askLabel=`Ask Alpha about this ${selected.kind==='video'?'video':'photo'}`;
      data.v.editLabel=selected.kind==='video'?'Edit video':'Edit photo';data.v.shareLabel=selected.kind==='video'?'Share video':'Share photo';data.v.infoLabel=selected.kind==='video'?'Video info':'Photo info';data.v.deleteLabel=selected.kind==='video'?'Delete video':'Delete photo';
      data.v.canEmail=!browserMode&&selected.kind!=='video'&&!selected.trashed&&nativeId(selected.id).startsWith('m:')&&!!selected.mutationRevision&&Capacitor.isPluginAvailable('AlphaMailAttachments')&&typeof views.inbox.fileEmailTarget==='function';
      data.v.email=()=>emailPhoto(selected,currentApi);
      // Info: date, file, size, dimensions, folder and albums.
      const albums=customAlbums.filter(album=>album.memberIds.includes(nativeId(selected.id))).map(album=>album.name);
      const facts=[['Date',`${new Date(shotAt(selected)).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'})} ${when.time}`],['File',selected.name||''],['Size',formatBytes(selected.size)],['Dimensions',selected.width&&selected.height?`${selected.width} × ${selected.height}`:''],['Length',durationLabel(selected)],['Folder',(selected.folder||'').replace(/\/$/,'')],['Albums',albums.join(', ')]].filter(([,value])=>value).map(([label,value])=>({label,value}));
      data.v.info2={date:when.day,time:when.time,desc:'',hasPlace:false,hasPeople:false,people:[],facts,hasFacts:true,canAlbum:!selected.trashed,addToAlbum:()=>{
        // The info sheet closes as the album sheet opens; focus returns to the viewer's Info control.
        const infoControl=document.querySelector<HTMLElement>(`[data-alpha-subview="photos-viewer"] button[aria-label="${data.v.infoLabel}"]`)||undefined;
        openAlbumManager(currentApi,selected,undefined,infoControl);if(manager)manager.choosing=true;currentApi.set({nativeAlbumDraft:Date.now()});}};
      data.infoOpen=st.sheet==='photo-info'||!!data.infoOpen;
      if(edit?.source===selected.id){const current=edit;data.v.ed={bg:`url("${current.image}") center / contain no-repeat`,tf:'',flt:'none',cropOn:current.crop,cropCss:current.crop?'background:#ffffff;color:#000000':'background:rgba(255,255,255,.12);color:#ffffff',status:current.uncertain?'Save outcome unknown. Tap Save copy to check it.':'',saveLabel:'Save copy',saveDisabled:current.busy,canReplace:!!current.canReplace&&!current.uncertain,replace:()=>void saveEdit(currentApi,true),rotate:()=>void transformEdit(currentApi,true),crop:()=>void transformEdit(currentApi,false),cancel:()=>{cancelEdit();currentApi.set({nativeEditRevision:Date.now()});},save:()=>void saveEdit(currentApi),filters:[['none','Original'],['vivid','Vivid'],['warm','Warm'],['cool','Cool'],['mono','Mono'],['fade','Fade'],['noir','Noir']].map(([id,label])=>({label,bg:`url("${selected.image}") center / cover no-repeat`,flt:({none:'none',vivid:'saturate(1.55) contrast(1.08)',warm:'sepia(.3) saturate(1.35) hue-rotate(-8deg)',cool:'saturate(1.1) hue-rotate(14deg) brightness(1.03)',mono:'grayscale(1) contrast(1.05)',fade:'contrast(.78) brightness(1.12) saturate(.75)',noir:'grayscale(1) contrast(1.55) brightness(.88)'} as Record<string,string>)[id],on:current.filter===id,ring:current.filter===id?'box-shadow:0 0 0 2px #000,0 0 0 4px #fff':'',lc:current.filter===id?'#fff':'rgba(255,255,255,.6)',pick:()=>void transformEdit(currentApi,false,id)}))};}
    }
    return data;
  };
  if (views.photos) views.photos.back = (st: Bag, currentApi: Bag) => { if(edit){cancelEdit();currentApi.set({nativeEditRevision:Date.now()});return true;}if(selection){cancelPhotoSelection(currentApi);return true;}if(st.sheet==='owned-album'){manager=undefined;currentApi.set({sheet:null});return true;}if(st.sheet==='empty'){cancelPermanent(currentApi);return true;}if(st.sheet)return photosBack?.(st,currentApi); if (preview?.id === st.open || captures.some(c => c.id === st.open) || albumRows.some(c => c.id === st.open)) { retirePhotoRead();currentApi.set({ open: null, nativePhotoSelection: null }); preview = undefined; closeVideo(); return true; } return photosBack?.(st, currentApi); };
  if(views.photos)views.photos.onLeave=(owner:Bag)=>{retirePhotoRead();deviceLibrary.leave();closeQuestion?.();closeQuestion=undefined;void photoAttachments.cancelPhotoSelected().catch(()=>{});cancelEdit();editRecoveryChecked=false;automaticEditRecovery='';selection=undefined;selectionTab=undefined;swallowedTap='';endHold();manager=undefined;const old=prepared;prepared=undefined;if(old)void library.cancelDeleteTrash({confirmation:old.confirmation}).catch(()=>{});owner.set({sheet:null});photosLeave?.(owner);};
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
    if (!session.recording || polling || session.finalizing) return;
    polling = true;
    try { const state = await camera.getRecordingState(); if (session.recording) { duration = state.duration; if (!state.isRecording) { limitStop = true; void finishVideo(); } else api?.set({ nativeRecordingTick: duration }); } }
    catch { if (session.recording) void finishVideo(); }
    finally { polling = false; }
  }, 500);
  let queued = false;
  let libraryWatching=false;
  const watchLibrary=(want:boolean)=>{if(browserMode||want===libraryWatching)return;libraryWatching=want;void nativeLibrary.watchLibrary({active:want}).catch(()=>{libraryWatching=false;});};
  // Photos: the library observer, an editor whose photo closed, and the mounted video follow Photos' presence.
  const syncPhotos = () => { watchLibrary(!disposed&&!document.hidden&&!!photosApi?.isActive()&&permittedLibrary());if((edit||videoEditSource)&&(!photosApi?.isActive()||photosApi.get('photos').open!==(edit?.source??videoEditSource)))cancelEdit(); mountVideo(); };
  // Camera: entering (or uncovering) Camera starts the session; leaving, hiding, or a chat sheet left open past the grace releases it.
  const syncCamera = () => { trackChat(); if (active()) { if (session.phase === 'off') void start(); else if (session.phase === 'ready') mask(true); } else if (session.phase !== 'off') void stop(); };
  const sync = () => { queued = false; if (disposed) return; syncPhotos(); syncCamera(); };
  function schedule() { if (!queued && !disposed) { queued = true; queueMicrotask(sync); } }
  // View enter/leave and chat cover come from the shell's own commits (and page visibility),
  // not from observing every DOM mutation in the document.
  const removePresence = installViewPresence(_Component, schedule);
  const resize = () => { if (session.phase === 'ready') mask(true); schedule(); };
  const visibility = () => { if (document.hidden) { retirePhotoRead();watchLibrary(false);cancelEdit();closeVideo();if(permittedLibrary()){++libraryEpoch;captures=[];albumRows=[];trash=[];albumNext='';trashNext='';albumKey='';counts=undefined;++countsEpoch;countsBusy=false;++albumsEpoch;albumsBusy=false;albumsLoaded=false;customAlbums=[];++albumEpoch;++trashEpoch;preview=undefined;selection=undefined;next='';loaded=false;photosApi?.set({open:null,nativePhotoSelection:null,nativeCaptureRevision:Date.now()});}void stop(); } else { loaded = false; if (photosApi?.isActive()) void refresh(); schedule(); } };
  let libraryChangeHandle:{remove():Promise<void>}|undefined;
  /** A MediaStore change: re-read what is loaded and patch it (FixPatch). The selection keeps rows that
   * still exist and the viewer stays open unless its item is gone. `hard` (the edited source changed
   * under a pending copy) also closes the editor and the viewer. */
  function invalidateLibrary(hard=false){
    counts=undefined;++countsEpoch;countsBusy=false;albumsLoaded=false;albumsBusy=false;++albumsEpoch;
    if(hard){retirePhotoRead();preview=undefined;cancelEdit();closeVideo();photosApi?.set({open:null,nativePhotoSelection:null,nativeCaptureRevision:Date.now()});}
    const owner=photosApi;
    if(!owner?.isActive()||document.hidden){loaded=false;return;}
    void refresh();void loadTrash(owner);void loadCounts(owner);void loadCustomAlbums(owner);
    const key=owner.get('photos')?.album;if(typeof key==='string'&&key&&key!=='trash')void loadAlbum(key,owner);
  }
  function checkPendingVideoSource(copy:PendingNativeVideoCopy){
    copy.checkAgain=true;if(copy.checking)return;
    copy.checking=(async()=>{
      while(copy.checkAgain&&pendingNativeVideoCopy===copy&&editEpoch===copy.epoch){
        copy.checkAgain=false;
        try{
          const [access,source]=await Promise.all([nativeLibrary.libraryAccess(),nativeLibrary.read({id:nativeId(copy.source.id)})]);
          if(disposed||pendingNativeVideoCopy!==copy||editEpoch!==copy.epoch)return;
          if(access.scope==='denied'||access.videos==='denied'||source.id!==nativeId(copy.source.id)||source.mutationRevision!==copy.source.mutationRevision||source.trashed){invalidateLibrary(true);return;}
          libraryAccess=access;
        }catch{if(!disposed&&pendingNativeVideoCopy===copy&&editEpoch===copy.epoch)invalidateLibrary(true);return;}
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
  const resumed=()=>{void restartAfterResume(()=>({denied:session.denied,phase:session.phase,disposed}),()=>cameraAccess.checkPermissions()).then(restart=>{if(restart){session.rearm();schedule();}});};
  let resumeHandle:{remove():Promise<void>}|undefined;
  void DailyApps.addListener('appResumed',resumed).then(handle=>{if(disposed)void handle.remove();else resumeHandle=handle;}).catch(()=>{});
  return () => { releaseHost();if(requestedPhoto===takeRequestedPhoto)requestedPhoto=undefined;window.clearTimeout(noticeTimer);noticeGeneration++;watchLibrary(false);deviceLibrary.dispose();captureQuestion=undefined;void libraryChangeHandle?.remove();hideAccess();void resumeHandle?.remove();window.removeEventListener('alpha:albums-document-changed',albumsChanged);if(scanApi&&prototype.api===scanApi)prototype.api=originalApi;disposed = true;cancelEdit();endHold();selection=undefined; clearInterval(timer); window.clearTimeout(chatTimer); closeVideo(); removePresence(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pageHide); window.removeEventListener('resize', resize); void stop(); style.remove(); captures = []; module.render = render; module.onLeave = leave; module.back = cameraBack; module.actions = cameraActions; if (scanRequest) scanRequest = undefined; if (views.photos) { views.photos.render = photosRender; views.photos.back = photosBack; views.photos.onLeave = photosLeave; } };

}
