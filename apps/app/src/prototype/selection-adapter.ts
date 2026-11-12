import {reviewFileEmail} from './file-email-review';
import {registerPlugin} from '../platform-plugins';
import {reviewMailAttachment,type MailAttachment} from '../runtime/inbox-attachment';
import type {Source} from './note-source-adapter';
const sourceFiles=registerPlugin<{readSelected(input:{selectionId:string}):Promise<MailAttachment & {sha256:string;size:number;sourceReferenceVersion?:1}>;retainSourceReference(input:{selectionId:string;sha256:string}):Promise<{reference?:string}>}>('AlphaMailAttachments');
import {reviewContentQuestion,SourceUnavailableError} from '../browser/content-question';
import {sensitiveReadingText} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts';
import { installFilesBrowserAdapter, type FilesStoragePort } from '../../../../.eliza/client-features/plugins/plugin-files/src/browser/files-browser-adapter.ts';
import { Capacitor } from '@capacitor/core';
import { DailyApps, type NativeResult } from '../daily';
import { filesIndex } from './files-index';
import { createInlineModal } from '../runtime/inline-modal';
import {errorNotice,ERROR_TOAST} from '../runtime/error-notice';

type Bag = Record<string, any>;
type Selection = { result: NativeResult; status: string; text?: string; pdf?: {page:number;count:number;image:string}; epoch: number; renames?: number; mediaFailed?:boolean };
type FilesReadStatus = 'pending' | 'ready' | 'incomplete' | 'failed';
const filesFilterNotices:Record<FilesReadStatus,string> = {
  pending:'Searching…',
  ready:'',
  incomplete:'Search results are incomplete.',
  failed:'Files could not read this filter.',
};

async function readFilesListing<T extends {status:string;message?:string}>(reply:Promise<T>) {
  const result=await reply;
  // The shared view handles denied access and navigation away from a missing folder.
  // Other read failures go through its existing persistent error state.
  if(!['ready','denied','missing'].includes(result.status))throw Error(result.message||'Files could not be read.');
  return result;
}

function previewMedia(result:NativeResult) {
  const native=Capacitor.isNativePlatform(),uri=result.uri,mime=result.mimeType||'';
  if(!uri||!(native?uri.startsWith('content://'):uri.startsWith('blob:')))return undefined;
  const kind=mime.split('/')[0];
  if(!['image','video','audio'].includes(kind)||mime==='image/svg+xml')return undefined;
  return {kind,url:native?Capacitor.convertFileSrc(uri):uri};
}

/** Install after installPrototypeNativeAdapters so real previews override fixture
 * action guards. Forward its returned callback through the onSelection option. Selections are restored only from native picker grants, never renderer-supplied URIs.
 * Uses the existing Files document page and Photos immersive viewer geometry.
 */
export function installSelectedDocumentAdapter(Component: {prototype: Bag}, views: Record<string, Bag>) {
  let epoch = 0;
  let current: Selection | undefined;
  let selectedApi: Bag | undefined;
  let restoreAttempted = false, restoringPicker = false;
  let pdfBusySelection: string | undefined;
  let pdfRequest = 0;
  let renameBusy = false;
  let playingPreview:HTMLMediaElement|null=null;
  const mediaRef=(element:HTMLMediaElement|null)=>{
    if(playingPreview===element)return;
    playingPreview?.pause();playingPreview=element;
    if(element){element.controls=true;if(element instanceof HTMLVideoElement)element.playsInline=true;}
  };
  const marker = '__native_selected_document';
  const rememberedPicker = (id:string) => filesIndex.list().some(row=>row.selectionId===id&&row.kind==='selected'&&row.status==='ready');
  let closeQuestion:(()=>void)|undefined;
  const release = (id: string) => { void DailyApps.forgetSelected({ selectionId: id }).catch(() => selectedApi?.toast('Reopen Files')); };
  /** Closing keeps a Recent selection's grant so Recent can reopen it; Forget
   * (or eviction from Recent) is what releases it. */
  const clear = (forget = false) => {
    closeQuestion?.();closeQuestion=undefined;
    mediaRef(null);
    epoch++;
    const id = current?.result.selectionId;
    current = undefined;
    filesIndex.setOpen(null);
    window.dispatchEvent(new CustomEvent('alpha-selected-context', { detail: null }));
    if (!id) return;
    if (forget) { const row = filesIndex.list().find(item => item.selectionId === id); if (row) filesIndex.remove(row.key); }
    if (forget || !filesIndex.has(id)) release(id);
  };
  const refresh = () => selectedApi?.setView('files', { nativeSelectionEpoch: epoch });
  /** The open selection's exact identity: its picker capability, the epoch it was accepted at and its rename count. */
  const publish = () => window.dispatchEvent(new CustomEvent('alpha-selected-context', { detail: current?.result.selectionId && current.result.status === 'selected' ? { kind: 'document', id: current.result.selectionId, revision: String(current.epoch) + (current.renames ? '.' + current.renames : '') } : null }));
  const open = async (api: Bag, selection:Selection, download=false) => {
    const selectionId = selection.result.selectionId;
    const active=()=>current===selection&&api.isActive()&&!document.hidden;
    if (!selectionId||!active()) return;
    try {
      const result=await (download?DailyApps.shareSelected({selectionId}):DailyApps.openSelected({selectionId}));
      if(active()&&result.status!=='opened')api.toast(errorNotice(result.message,'Unavailable'),ERROR_TOAST);
    } catch { if(active())api.toast('Unavailable'); }
  };
  let sharing = false;
  const share = async (api: Bag) => {
    const id = current?.result.selectionId;
    if (!id || sharing) return;
    sharing = true;
    try {
      const result = await DailyApps.shareSelected({ selectionId: id });
      if (result.status !== 'opened') api.toast(errorNotice(result.message, 'Share failed'), ERROR_TOAST);
    } catch { api.toast('Share failed'); }
    finally { sharing = false; }
  };
  const pdfPage = async (page: number, api: Bag) => {
    const selected = current;
    if (!selected || pdfBusySelection === selected.result.selectionId) return;
    pdfBusySelection = selected.result.selectionId; const request = ++pdfRequest;
    try {
      const response = await DailyApps.pdfSelected({selectionId: selected.result.selectionId!, page});
      if (current !== selected) return;
      if (response.status === 'rendered' && (response.imageUri?.startsWith('file://') || (!Capacitor.isNativePlatform() && response.imageUri?.startsWith('blob:'))) && Number.isInteger(response.pageCount) && Number.isInteger(response.page)) {
        current = {...selected, text:response.text, pdf: {page:response.page!, count:response.pageCount!, image:response.imageUri!.startsWith('blob:') ? response.imageUri! : Capacitor.convertFileSrc(response.imageUri!) + '?page=' + page + '&v=' + Date.now()}, status: response.message || 'PDF loaded'};
      } else { current = {...selected, pdf: undefined, status: response.message || 'PDF preview unavailable'}; }
      refresh();
    } catch { if(current === selected){current={...selected,pdf:undefined,status:'No preview'};refresh();} }
    finally { if(pdfRequest === request)pdfBusySelection = undefined; }
  };
  const rename = async (api: Bag) => {
    const selected = current; if(!selected || renameBusy)return;
    if(pdfBusySelection === selected.result.selectionId)return api.toast('Still loading');
    const name = String(api.get('files').rn || '').trim();
    if(!name)return api.toast('Name required');
    renameBusy = true;
    try {
      const response = await DailyApps.renameSelected({selectionId:selected.result.selectionId!,name});
      if(current !== selected)return;
      if(response.status === 'renamed-reselect'){
        window.dispatchEvent(new CustomEvent('alpha-selected-context', {detail:null}));
        // Native already forgot the old grant: drop its Recent row and restore marker without releasing it again.
        const old=filesIndex.list().find(row=>row.selectionId===selected.result.selectionId);if(old)filesIndex.remove(old.key);filesIndex.setOpen(null);
        current={result:response,status:response.message || 'Reselect file',epoch:++epoch};
        api.set({renaming:false});refresh();return;
      }
      if(response.status !== 'selected'){api.toast(errorNotice(response.message, 'Rename unavailable'), ERROR_TOAST);return;}
      // A rename changes the selected object: publish it as a new revision so a turn or
      // approval prepared for the old name cannot be dispatched against the renamed file.
      // Keep Recent on the new name: same row, or the replacement capability when the provider issued one.
      const old=filesIndex.list().find(row=>row.selectionId===selected.result.selectionId);
      if(old&&response.selectionId){if(old.selectionId!==response.selectionId)filesIndex.remove(old.key);for(const evicted of filesIndex.record({kind:old.kind,...(old.treeId?{treeId:old.treeId}:{}),name:response.name||'Selected document',mimeType:response.mimeType||'application/octet-stream',selectionId:response.selectionId}))if(evicted!==response.selectionId)release(evicted);}
      if(response.selectionId&&old?.kind==='selected'&&rememberedPicker(response.selectionId))filesIndex.setOpen(response.selectionId);
      else if(filesIndex.open()===selected.result.selectionId)filesIndex.setOpen(null);
      current={...selected,result:response,pdf:undefined,renames:(selected.renames||0)+1};api.set({renaming:false});publish();refresh();
      if(response.mimeType==='application/pdf')await pdfPage(selected.pdf?.page || 0,api);
    } catch {if(current === selected)api.toast('Unconfirmed');}
    finally {renameBusy=false;}
  };
  for (const module of ['files', 'photos']) {
    const definition = views[module];
    if (!definition?.render) continue;
    const render = definition.render;
    definition.render = (st: Bag, api: Bag) => {
      const data = render(st, api);
      if(module === 'files') {
        const browse = api.isActive()&&!document.hidden&&!st.open&&!st.folder;
        if(!browse)restoringPicker=false;
        else if(!restoreAttempted&&Capacitor.isNativePlatform()) {
          restoreAttempted=true;
          const requestedEpoch=epoch,openId=filesIndex.open();
          if(openId&&!current){
            // Earlier renderers also saved transient Files-browser selections here.
            if(!rememberedPicker(openId))filesIndex.setOpen(null);
            else {
              restoringPicker=true;
              void DailyApps.describeSelected({selectionId:openId}).then(result=>{
                if(!restoringPicker||epoch!==requestedEpoch||current||!api.isActive()||document.hidden||api.get('files').open||api.get('files').folder||filesIndex.open()!==openId||!rememberedPicker(openId))return;
                if(result.status==='selected'&&result.selectionId===openId&&result.action==='files')void accept('files',result,api,{kind:'selected'});
                else if(result.status==='unavailable')filesIndex.setOpen(null);
              }).catch(()=>{}).finally(()=>{restoringPicker=false;});
            }
          }
        }
      }
      if (st.open !== marker || !current) return data;
      const selected = current;
      const name = selected.result.name || 'Selected document';
      const mime = selected.result.mimeType || 'application/octet-stream';
      const uri = selected.result.uri;
      const image = mime.startsWith('image/') && (uri?.startsWith('content://') || (!Capacitor.isNativePlatform() && uri?.startsWith('blob:'))) ? Capacitor.convertFileSrc(uri) : undefined;
      const close = () => { clear(); api.set({ open: null }); };
      const forget = () => { clear(true); api.set({ open: null }); };
      const canAsk=selected.result.status==='selected'&&(!!selected.text?.trim()||!!image||!!selected.pdf?.image);
      const questionCurrent=()=>current===selected&&api.isActive()&&api.get(module).open===marker&&!document.hidden;
      const ask=()=>{
        if(!canAsk||!questionCurrent())return;
        closeQuestion?.();
        closeQuestion=reviewContentQuestion({name:selected.pdf?name+' · page '+(selected.pdf.page+1):name,text:selected.text??'',current:questionCurrent,validate:text=>!sensitiveReadingText(text),compose:(draft,source)=>api.composeContentQuestion(draft,source),...(selected.result.selectionId&&['text/plain','application/pdf','image/png','image/jpeg','image/webp'].includes(mime)?{source:async():Promise<Source>=>{const file=await sourceFiles.readSelected({selectionId:selected.result.selectionId!}).catch(error=>{throw error?.code==='too-large'?new SourceUnavailableError('This file is too large to link as a source. Turn off the source link to ask without one.'):error;}),checked=await reviewMailAttachment(file);if(!questionCurrent()||checked.sha256!==file.sha256||checked.size!==file.size||file.name!==selected.result.name||file.mimeType!==mime||mime==='text/plain'&&selected.text!==undefined&&checked.text?.replace(/^\uFEFF/,'')!==selected.text)throw Error('Source changed');const reference=file.sourceReferenceVersion===1?(await sourceFiles.retainSourceReference({selectionId:selected.result.selectionId!,sha256:checked.sha256})).reference:undefined;if(!questionCurrent())throw Error('Selection changed');return {version:1,name:file.name,mimeType:file.mimeType,sha256:checked.sha256,size:checked.size,...(reference?{reference}:{})};}}:{}),...(image||selected.pdf?{image:async(signal:AbortSignal)=>(await fetch(image||selected.pdf!.image,{signal})).blob()}: {})});
      };
      const email=()=>{
        closeQuestion?.();
        closeQuestion=reviewFileEmail({
          read:async()=>{const file=await sourceFiles.readSelected({selectionId:selected.result.selectionId!});if(file.name!==name||file.mimeType!==mime)throw Error('Selected file changed. Select it again.');return file;},
          current:()=>current===selected&&api.isActive()&&api.get(module).open===marker&&!renameBusy,
          target:()=>views.inbox.fileEmailTarget(),insert:(file,token)=>views.inbox.attachReviewedFile(file,token),
          inserted:()=>api.open('inbox'),
        });
      };
      if (module === 'files') {
        const media=selected.mediaFailed?undefined:previewMedia(selected.result);
        const rows = selected.text?.split('\n').map((v, i) => ({ k: String(i + 1), v })) || [];
        // Fixed prototype page geometry: chunk rows into successive pages so long
        // text is scrollable rather than silently clipped to the first page.
        const pages = [];
        for (let i = 0; i < rows.length; i += 8) pages.push({ first: true, rest: false, heading: i ? name + ' (continued)' : name, rows: rows.slice(i, i + 8), lines: [], num: '' });
        data.isPreview = true;
        data.pv = {
          needsReselect:selected.result.status === 'renamed-reselect', reselect:async()=>{try{const result=await DailyApps.perform({action:'files'});if(current===selected&&result.status==='selected')await accept('files',result,api);}catch{api.toast('Picker failed');}},
          canEmail:typeof views.inbox.fileEmailTarget==='function'&&selected.result.status==='selected'&&['text/plain','application/pdf','image/png','image/jpeg','image/webp'].includes(mime),email,
          name, nativeSelectionId:selected.result.selectionId, base: name, ext: '', canForget:true, forget, meta: mime + ' · selected on this device', d: '',
          isPages: !!selected.pdf||rows.length>0, pages: selected.pdf ? [] : pages, isPdf: !!selected.pdf, pdfImage: selected.pdf?.image || '', pdfLabel: selected.pdf ? 'Page ' + (selected.pdf.page+1) + ' of ' + selected.pdf.count : '', pdfPrevious: () => selected.pdf && selected.pdf.page > 0 ? pdfPage(selected.pdf.page-1,api) : undefined, pdfNext: () => selected.pdf && selected.pdf.page+1 < selected.pdf.count ? pdfPage(selected.pdf.page+1,api) : undefined, pdfHasPrevious: !!selected.pdf && selected.pdf.page > 0, pdfHasNext: !!selected.pdf && selected.pdf.page+1 < selected.pdf.count, paper: '#FFFFFF', isPhoto: false,
          mediaImage:media?.kind==='image',mediaVideo:media?.kind==='video',mediaAudio:media?.kind==='audio',mediaUrl:media?.url,mediaRef,
          mediaError:()=>{if(current!==selected)return;current={...selected,mediaFailed:true,status:'Preview unavailable for this file.'};refresh();},
          previewStatus:!media&&!selected.pdf&&selected.text===undefined?selected.status:'',
          canOpenElsewhere:selected.result.status==='selected'&&!!selected.result.selectionId,
          openElsewhereLabel:Capacitor.isNativePlatform()?'Open in Android':'Download file',openElsewhere:()=>void open(api,selected,!Capacitor.isNativePlatform()),
          photoBg: image ? `url(${JSON.stringify(image)}) center / contain no-repeat` : '', photoSun: 'none',
          isReceipt: false, isAudio: false, isArchive: false, receipt: null, contents: [],
          renaming: !!st.renaming, notRenaming: !st.renaming, rn: typeof st.rn === 'string' ? st.rn : name, onRn: (event: Event) => api.set({rn:(event.target as HTMLInputElement).value}), saveRn: () => rename(api), rnKey: (event: KeyboardEvent) => {if(event.key === 'Enter'){event.preventDefault();void rename(api);}if(event.key === 'Escape')api.set({renaming:false});}, asking: false, asked: false, canAsk,
          askLabel: 'Ask Alpha', ask, close,
          startRename: () => selected.result.status === 'renamed-reselect' ? api.toast('Reselect file') : api.set({renaming:true,rn:name}),
          share: () => share(api), move: () => api.toast('Can’t move here'), del: () => api.toast('Delete in Android'),
        };
      } else if (image) {
        data.viewing = true; data.viewEmpty = false; data.editing = false;
        data.v = { bg: `url(${JSON.stringify(image)}) center / contain no-repeat`, tf: '', flt: '', slide: '', day: name, sub: '', chromeOp: 1, chromePE: 'auto', favIcon: '', favLabel: 'Open in Android', vid: false, playBtn: false, playing: false, notSecure: true,
          tap: () => {}, down: () => {}, up: () => {}, share: () => share(api), fav: () => open(api,selected), edit: () => open(api,selected), del: () => api.toast('Delete in Android'), info: () => api.toast(name + ' · ' + mime), ask, close };
      }
      return data;
    };
    if(module==='files') {
      const leave=definition.onLeave;
      definition.onLeave=(...args:unknown[])=>{restoringPicker=false;return leave?.(...args);};
    }
    const back = definition.back;
    definition.back = (st: Bag, api: Bag) => { if (st.open === marker) { clear(); api.set({ open: null }); return true; } return back?.(st, api); };
  }
  async function accept(module: string, result: NativeResult, api: Bag, recent: {kind:'selected'}|{kind:'tree';treeId:string}|false = {kind:'selected'}) {
    if (!Capacitor.isNativePlatform()&&result.status==='selected'&&result.action==='photos'&&result.selectionId?.startsWith('browser-photo:')) { clear();api.open('photos',{open:'native-camera-'+result.selectionId.slice(14)});return; }
    if (result.status !== 'selected' || !result.selectionId) return;
    clear();
    if (recent) for (const evicted of filesIndex.record({ ...recent, name: result.name || 'Selected document', mimeType: result.mimeType || 'application/octet-stream', selectionId: result.selectionId })) if (evicted !== result.selectionId) release(evicted);
    if(recent&&recent.kind==='selected'&&rememberedPicker(result.selectionId))filesIndex.setOpen(result.selectionId);
    const requestEpoch = epoch;
    current = { result, status: 'Reading selected document…', epoch: requestEpoch };
    publish();
    selectedApi = api;
    const target = result.mimeType?.startsWith('image/') && (module === 'photos' || result.action === 'photos') ? 'photos' : 'files';
    api.open(target, { open: marker });
    if (target === 'photos') return;
    if (result.mimeType === 'application/pdf') {await pdfPage(0,api);return;}
    if (previewMedia(result)) return;
    try {
      const response = await DailyApps.readSelected({ selectionId: result.selectionId });
      if (epoch !== requestEpoch || current?.result.selectionId !== result.selectionId) return;
      current = { ...current, text: response.status === 'read' ? response.text : undefined, status: response.message || (response.text !== undefined ? 'Loaded' : 'No preview') };
      // Native currently returns status "read"; use only a successful text result.
      refresh();
    } catch {
      if (epoch !== requestEpoch || !current) return;
      current = { ...current, text: undefined, status: 'Unreadable' }; refresh();
    }
  }
  const storage=registerPlugin<FilesStoragePort<NativeResult>>('AlphaFiles');
  let filterRead:{status:FilesReadStatus}|undefined;
  const observedReads:Partial<FilesStoragePort<NativeResult>>={
    async storageQuery(input){
      const read:{status:FilesReadStatus}={status:'pending'};
      filterRead=read;
      try {
        const result=await storage.storageQuery(input);
        const incomplete='truncated' in result&&result.truncated===true;
        read.status=result.status!=='ready'?'failed':incomplete?'incomplete':'ready';
        return result;
      } catch(error) {
        read.status='failed';
        throw error;
      }
    },
    storageList(input){return readFilesListing(storage.storageList(input));},
    storageCategory(input){return input.countOnly?storage.storageCategory(input):readFilesListing(storage.storageCategory(input));},
  };
  Component.prototype.filesAgent=installFilesBrowserAdapter(views.files as Parameters<typeof installFilesBrowserAdapter>[0],accept,clear,{
    storage:new Proxy(storage,{get:(target,key)=>Object.hasOwn(observedReads,key)?Reflect.get(observedReads,key):Reflect.get(target,key)}),
    createInlineModal,
    menuFocus:()=>document.querySelector<HTMLElement>('[data-alpha-subview="files-folder"] button[aria-label="Files options"]'),
    forgetSelected:selectionId=>DailyApps.forgetSelected({selectionId}),
  });
  const renderFiles=views.files.render;
  views.files.render=(state:Bag,api:Bag)=>{
    const out=renderFiles(state,api),items=out.fd?.items;out.filePlacement=true;
    const storageAccessible=!out.browse?.denied&&!out.browse?.unavailable;
    const filterStatus=out.chip&&storageAccessible?filterRead?.status:undefined;
    out.filterEmpty=out.filterEmpty&&filterStatus==='ready';
    out.filterReadNotice=filterStatus?filesFilterNotices[filterStatus]:'';
    if(out.fd?.empty&&!storageAccessible){
      out.fd.empty=false;
      out.nativeTreeStatus||='Files could not be read.';
    }
    if(out.toolbar?.ready&&!out.toolbar.canCreate){const create=out.toolbar.newFolder;out.toolbar.canCreate=true;out.toolbar.newFolder=()=>{out.browse.allFiles();create();};}
    if(out.fd?.menuRows){
      const modes=[{mode:'name',icon:'type',up:'Name A–Z',down:'Name Z–A'},{mode:'date',icon:'calendar',up:'Newest first',down:'Oldest first'},{mode:'size',icon:'hard-drive',up:'Largest first',down:'Smallest first'}];
      out.fd.menuRows=[...modes.flatMap(choice=>[false,true].map(reverse=>({id:'sort:'+choice.mode+':'+reverse,label:reverse?choice.down:choice.up,on:(state.sort==='name'||state.sort==='size'?state.sort:'date')===choice.mode&&!!state.sortReverse===reverse,iconStyle:`mask:url('/icons/lucide/${choice.icon}.svg') center/contain no-repeat`,directionStyle:`mask:url('/icons/lucide/${reverse?'arrow-up':'arrow-down'}.svg') center/contain no-repeat`,go:()=>api.set({menu:false,sort:choice.mode,sortReverse:reverse})}))),...out.fd.menuRows.filter((row:Bag)=>!row.id.startsWith('sort:')&&row.id!=='reverse-order')];
    }out.shareAvailable=Capacitor.isNativePlatform()||(typeof navigator.share==='function'&&typeof navigator.canShare==='function');
    if(!Capacitor.isNativePlatform()&&Array.isArray(items)&&items.length&&items.every((row:Bag)=>{try{return /^Photos\/(Images|Videos)\//.test(JSON.parse(row.id)[1]);}catch{return false;}})){
      out.mediaCollection=true;out.filePlacement=false;out.canRename=false;
      out.selSaveLocally=()=>registerPlugin<{storageSaveMedia(input:{paths:string[]}):Promise<unknown>}>('AlphaFiles').storageSaveMedia({paths:items.filter((row:Bag)=>row.selOn).map((row:Bag)=>JSON.parse(row.id)[1])});
    }
    return out;
  };
  return accept;
}
