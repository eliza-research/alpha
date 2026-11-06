import {reviewFileEmail} from './file-email-review';
import {registerPlugin} from '../platform-plugins';
import {reviewMailAttachment,type MailAttachment} from '../runtime/inbox-attachment';
import type {Source} from './note-source-adapter';
const sourceFiles=registerPlugin<{readSelected(input:{selectionId:string}):Promise<MailAttachment & {sha256:string;size:number;sourceReferenceVersion?:1}>;retainSourceReference(input:{selectionId:string;sha256:string}):Promise<{reference?:string}>}>('AlphaMailAttachments');
import {reviewContentQuestion} from '../browser/content-question';
import {sensitiveReadingText} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts';
import { installFilesBrowserAdapter } from './files-browser-adapter';
import { Capacitor } from '@capacitor/core';
import { DailyApps, type NativeResult } from '../daily';
import { filesIndex } from './files-index';

type Bag = Record<string, any>;
type Selection = { result: NativeResult; status: string; text?: string; pdf?: {page:number;count:number;image:string}; epoch: number; renames?: number };

/** Install after installPrototypeNativeAdapters so real previews override fixture
 * action guards. Forward its returned callback through the onSelection option. Selections are restored only from native picker grants, never renderer-supplied URIs.
 * Uses the existing Files document page and Photos immersive viewer geometry.
 */
export function installSelectedDocumentAdapter(_Component: unknown, views: Record<string, Bag>) {
  let epoch = 0;
  let current: Selection | undefined;
  let selectedApi: Bag | undefined;
  let restoreAttempted = false;
  let pdfBusySelection: string | undefined;
  let pdfRequest = 0;
  let renameBusy = false;
  const marker = '__native_selected_document';
  let closeQuestion:(()=>void)|undefined;
  const release = (id: string) => { void DailyApps.forgetSelected({ selectionId: id }).catch(() => selectedApi?.toast('Document access could not be released. Reopen Files and try again.')); };
  /** Closing keeps a Recent selection's grant so Recent can reopen it; Forget
   * (or eviction from Recent) is what releases it. */
  const clear = (forget = false) => {
    closeQuestion?.();closeQuestion=undefined;
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
  const open = async (api: Bag) => {
    const selectionId = current?.result.selectionId;
    if (!selectionId) return;
    try { const r = await DailyApps.openSelected({ selectionId }); api.toast(r.message || (r.status === 'opened' ? 'Opened in the Android document app' : 'Document unavailable')); }
    catch { api.toast('Document unavailable. Select it again.'); }
  };
  let sharing = false;
  const share = async (api: Bag) => {
    const id = current?.result.selectionId;
    if (!id || sharing) return;
    sharing = true;
    try {
      const result = await DailyApps.shareSelected({ selectionId: id });
      if (result.status !== 'opened') api.toast(result.message || 'This item could not be shared. Select it again.');
    } catch { api.toast('Sharing could not open. Select this item again.'); }
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
    } catch { if(current === selected){current={...selected,pdf:undefined,status:'PDF preview unavailable. Select this document again.'};refresh();} }
    finally { if(pdfRequest === request)pdfBusySelection = undefined; }
  };
  const rename = async (api: Bag) => {
    const selected = current; if(!selected || renameBusy)return;
    if(pdfBusySelection === selected.result.selectionId)return api.toast('Wait for the PDF page to finish loading before renaming.');
    const name = String(api.get('files').rn || '').trim();
    if(!name)return api.toast('Enter a file name.');
    renameBusy = true;
    try {
      const response = await DailyApps.renameSelected({selectionId:selected.result.selectionId!,name});
      if(current !== selected)return;
      if(response.status === 'renamed-reselect'){
        window.dispatchEvent(new CustomEvent('alpha-selected-context', {detail:null}));
        current={result:response,status:response.message || 'Select the renamed file to continue.',epoch:++epoch};
        api.set({renaming:false});refresh();return;
      }
      if(response.status !== 'selected'){api.toast(response.message || 'Rename unavailable');return;}
      // A rename changes the selected object: publish it as a new revision so a turn or
      // approval prepared for the old name cannot be dispatched against the renamed file.
      current={...selected,result:response,pdf:undefined,renames:(selected.renames||0)+1};api.set({renaming:false});publish();refresh();
      if(response.mimeType==='application/pdf')await pdfPage(selected.pdf?.page || 0,api);
    } catch {if(current === selected)api.toast('Rename could not be confirmed. Refresh or reselect before retrying.');}
    finally {renameBusy=false;}
  };
  for (const module of ['files', 'photos']) {
    const definition = views[module];
    if (!definition?.render) continue;
    const render = definition.render;
    definition.render = (st: Bag, api: Bag) => {
      const data = render(st, api);
      if(module === 'files' && api.active && !restoreAttempted && Capacitor.isNativePlatform()) {
        restoreAttempted = true; const requestedEpoch = epoch;
        const openId = filesIndex.open(); if (openId) void DailyApps.describeSelected({ selectionId: openId }).then(result => {if(epoch === requestedEpoch && !current && result.status === 'selected')void accept('files',result,api);}).catch(()=>{});
      }
      if (st.open !== marker || !current) return data;
      const selected = current;
      const name = selected.result.name || 'Selected document';
      const mime = selected.result.mimeType || 'application/octet-stream';
      const uri = selected.result.uri;
      const image = mime.startsWith('image/') && (uri?.startsWith('content://') || (!Capacitor.isNativePlatform() && uri?.startsWith('blob:'))) ? Capacitor.convertFileSrc(uri) : undefined;
      const close = () => { clear(); api.set({ open: null }); };
      const forget = () => { clear(true); api.set({ open: null }); };
      const ask=()=>{
        closeQuestion?.();
        closeQuestion=reviewContentQuestion({name:selected.pdf?name+' · page '+(selected.pdf.page+1):name,text:selected.text??'',current:()=>current===selected&&api.get(module).open===marker&&!document.hidden,validate:text=>!sensitiveReadingText(text),compose:(draft,source)=>api.composeContentQuestion(draft,source),...(selected.result.selectionId&&['text/plain','application/pdf','image/png','image/jpeg','image/webp'].includes(mime)?{source:async():Promise<Source>=>{const file=await sourceFiles.readSelected({selectionId:selected.result.selectionId!}),checked=await reviewMailAttachment(file);if(current!==selected||checked.sha256!==file.sha256||checked.size!==file.size||file.name!==selected.result.name||file.mimeType!==mime||mime==='text/plain'&&checked.text!==selected.text)throw Error('Source changed');const reference=file.sourceReferenceVersion===1?(await sourceFiles.retainSourceReference({selectionId:selected.result.selectionId!,sha256:checked.sha256})).reference:undefined;if(current!==selected)throw Error('Selection changed');return {version:1,name:file.name,mimeType:file.mimeType,sha256:checked.sha256,size:checked.size,...(reference?{reference}:{})};}}:{}),...(image?{image:async(signal:AbortSignal)=>(await fetch(image,{signal})).blob()}: {})});
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
        const rows = selected.text === undefined
          ? [{ k: 'Status', v: selected.status }]
          : selected.text.split('\n').map((v, i) => ({ k: String(i + 1), v }));
        // Fixed prototype page geometry: chunk rows into successive pages so long
        // text is scrollable rather than silently clipped to the first page.
        const pages = [];
        for (let i = 0; i < rows.length; i += 8) pages.push({ first: true, rest: false, heading: i ? name + ' (continued)' : name, rows: rows.slice(i, i + 8), lines: [], num: '' });
        data.isPreview = true;
        data.pv = {
          needsReselect:selected.result.status === 'renamed-reselect', reselect:async()=>{try{const result=await DailyApps.perform({action:'files'});if(current===selected&&result.status==='selected')await accept('files',result,api);}catch{api.toast('File picker unavailable. Try again.');}},
          canEmail:typeof views.inbox.fileEmailTarget==='function'&&selected.result.status==='selected'&&['text/plain','application/pdf','image/png','image/jpeg','image/webp'].includes(mime),email,
          name, nativeSelectionId:selected.result.selectionId, base: name, ext: '', canForget:true, forget, meta: mime + ' · selected on this device', d: '',
          isPages: !image, pages: selected.pdf ? [] : pages, isPdf: !!selected.pdf, pdfImage: selected.pdf?.image || '', pdfLabel: selected.pdf ? 'Page ' + (selected.pdf.page+1) + ' of ' + selected.pdf.count : '', pdfPrevious: () => selected.pdf && selected.pdf.page > 0 ? pdfPage(selected.pdf.page-1,api) : undefined, pdfNext: () => selected.pdf && selected.pdf.page+1 < selected.pdf.count ? pdfPage(selected.pdf.page+1,api) : undefined, pdfHasPrevious: !!selected.pdf && selected.pdf.page > 0, pdfHasNext: !!selected.pdf && selected.pdf.page+1 < selected.pdf.count, paper: '#FFFFFF', isPhoto: !!image,
          photoBg: image ? `url(${JSON.stringify(image)}) center / contain no-repeat` : '', photoSun: 'none',
          isReceipt: false, isAudio: false, isArchive: false, receipt: null, contents: [],
          renaming: !!st.renaming, notRenaming: !st.renaming, rn: typeof st.rn === 'string' ? st.rn : name, onRn: (event: Event) => api.set({rn:(event.target as HTMLInputElement).value}), saveRn: () => rename(api), rnKey: (event: KeyboardEvent) => {if(event.key === 'Enter'){event.preventDefault();void rename(api);}if(event.key === 'Escape')api.set({renaming:false});}, asking: false, asked: false, canAsk: true,
          askLabel: 'Ask Alpha', ask, close,
          startRename: () => selected.result.status === 'renamed-reselect' ? api.toast('Select the renamed file before making another change.') : api.set({renaming:true,rn:name}),
          share: () => share(api), move: () => api.toast('Moving requires access to the source and destination folders. This selection cannot be moved here yet.'), del: () => api.toast('Delete in the Android document app.'),
        };
      } else if (image) {
        data.viewing = true; data.viewEmpty = false; data.editing = false;
        data.v = { bg: `url(${JSON.stringify(image)}) center / contain no-repeat`, tf: '', flt: '', slide: '', day: name, sub: 'Selected on this device', chromeOp: 1, chromePE: 'auto', favIcon: '', favLabel: 'Open in Android', vid: false, playBtn: false, playing: false, notSecure: true,
          tap: () => {}, down: () => {}, up: () => {}, share: () => share(api), fav: () => open(api), edit: () => open(api), del: () => api.toast('Delete in the Android photo app.'), info: () => api.toast(name + ' · ' + mime), ask, close };
      }
      return data;
    };
    const back = definition.back;
    definition.back = (st: Bag, api: Bag) => { if (st.open === marker) { clear(); api.set({ open: null }); return true; } return back?.(st, api); };
  }
  async function accept(module: string, result: NativeResult, api: Bag, recent: {kind:'selected'}|{kind:'tree';treeId:string}|false = {kind:'selected'}) {
    if (result.status !== 'selected' || !result.selectionId) return;
    clear();
    if (recent) for (const evicted of filesIndex.record({ ...recent, name: result.name || 'Selected document', mimeType: result.mimeType || 'application/octet-stream', selectionId: result.selectionId })) if (evicted !== result.selectionId) release(evicted);
    filesIndex.setOpen(result.selectionId);
    const requestEpoch = epoch;
    current = { result, status: 'Reading selected document…', epoch: requestEpoch };
    publish();
    selectedApi = api;
    const target = result.mimeType?.startsWith('image/') && (module === 'photos' || result.action === 'photos') ? 'photos' : 'files';
    api.open(target, { open: marker });
    if (target === 'photos') return;
    if (result.mimeType === 'application/pdf') {await pdfPage(0,api);return;}
    try {
      const response = await DailyApps.readSelected({ selectionId: result.selectionId });
      if (epoch !== requestEpoch || current?.result.selectionId !== result.selectionId) return;
      current = { ...current, text: response.status === 'read' ? response.text : undefined, status: response.message || (response.text !== undefined ? 'Loaded' : 'Preview unsupported. Open in Android to view this document.') };
      // Native currently returns status "read"; use only a successful text result.
      refresh();
    } catch {
      if (epoch !== requestEpoch || !current) return;
      current = { ...current, text: undefined, status: 'Could not read this document. Select it again or open in Android.' }; refresh();
    }
  }
  installFilesBrowserAdapter(views,accept,clear);
  return accept;
}
