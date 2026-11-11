// NoteSourceDialog against installNoteSourceAdapter and releaseUnusedSourceReferences in
// apps/app/src/prototype/note-source-adapter.ts, mounted in a DOM on the Android path.
// Ports: the system picker (DailyApps), the AlphaMailAttachments plugin, the byte review and
// the Notes view api. Every port call is answered by a model step.
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {loadProductModule, modelTraces, replayTraces, settle, witnessTraces} from './notes-files-media-itf.mjs';

const source = 'apps/app/src/prototype/note-source-adapter.ts';
const globals = ['window', 'document', 'HTMLElement'];
const reference = id => `a1:${id.toString(16).padStart(64, '0')}`, referenceId = text => text ? parseInt(text.slice(3), 16) : 0;
const digest = file => String(file).repeat(64);
const link = (file, ref) => ({version: 1, name: `file-${file}.txt`, mimeType: 'text/plain', sha256: digest(file), size: 2048 * file, ...(ref ? {reference: reference(ref)} : {})});
const statuses = [[/^$/, 'none'], [/^Choose a file…$/, 'choosing'], [/^Selection cancelled/, 'cancelled'], [/^Source linked\.$/, 'linked'],
  [/^Source link removed/, 'removed'], [/^(Matching source opened\.|Opened\.)$/, 'opened'], [/^Opening verified source…$/, 'opening'],
  [/^File access could not be released/, 'release-failed'], [/./, 'error']];

export async function replayNoteSourceDialog({rewrite, ...options} = {}) {
  const model = {path: 'specs/quint/application/NoteSourceDialog.qnt', main: 'NoteSourceDialog'};
  const traces = [...modelTraces({...model, ...options}), ...witnessTraces({...model, witnesses: ['LinkSavedWitness', 'ReplacedReferenceMaintainedWitness',
    'MatchingFileOpenedWitness', 'OrphanReferenceWitness', 'ReleaseRefusedWitness', 'LinkedReferenceOpenedWitness', 'ViewerAnsweredWitness']})];
  const product = await loadProductModule(source, {rewrite, stubs: {
    '../runtime/abort-signal': 'export const anyAbortSignal=()=>new AbortController().signal;',
    '@capacitor/core': 'export const Capacitor={getPlatform:()=>"android",isNativePlatform:()=>true};',
    '../browser/file-picker': 'export const runFilePicker=async()=>null,inputFiles=async()=>[];',
    '../daily': 'export const DailyApps=new Proxy({},{get:(_target,name)=>input=>globalThis.__alphaNoteSourcePorts.daily(name,input)});',
    '../platform-plugins': 'export const registerPlugin=()=>new Proxy({},{get:(_target,name)=>input=>globalThis.__alphaNoteSourcePorts.attachments(name,input)});',
    '../runtime/inbox-attachment': 'export const reviewMailAttachment=async file=>globalThis.__alphaNoteSourcePorts.review(file);',
  }});
  return replayTraces(traces, {
    required: ['openDialog', 'closeDialog', 'leaveNotes', 'enterNotes', 'outsideEdit', 'choose', 'pickSettles', 'readSettles', 'retainSettles',
      'remove', 'saveSettles', 'viewSettles', 'openLinked', 'linkedSettles', 'releaseSettles', 'maintain'],
    reached: {
      'a stale action that only gives its selection back': ({s}) => s.op.stage === 'release' && s.status === 'choosing',
      'a retained reference no note names': ({s}) => s.refs.some(id => id !== s.linkRef) && s.op.stage === 'none',
      'a saved link': ({s}) => s.op.mode === 'link' && s.link === s.op.file && s.rev > s.edits,
      'a replaced or removed reference': ({s}) => s.maintains > 0,
      'a refused release': ({s}) => s.leaked.length > 0,
      'a viewer opened for the matching file': ({s}) => s.op.stage === 'view',
      'an abandoned action outliving its dialog': ({s}) => s.op.stage !== 'none' && s.opGen !== s.gen,
      'a viewer cancelled on close': ({s}) => s.cancels > 0,
    },
    // The reviewed revision and the viewer flag are closure state. The dialog repaints its
    // source when an action ends, so the shown source is compared between actions.
    project: ({s}) => ({visit: s.visit, rev: s.rev, link: s.link, linkRef: s.linkRef, gen: s.gen, open: s.open,
      shown: s.open && s.op.stage === 'none' ? {source: s.source, referenced: s.sourceRef !== 0} : null,
      status: s.status, stage: s.op.stage, serial: s.serial, grants: s.grants, leaked: s.leaked, refSerial: s.refSerial, refs: s.refs,
      edits: s.edits, views: s.views, cancels: s.cancels, maintains: s.maintains}),
    async start(initial) {
      const dom = new JSDOM('<!doctype html><body></body>', {url: 'https://alpha.example/'}), {window} = dom;
      const saved = Object.fromEntries(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
      window.HTMLElement.prototype.showModal ??= function () { this.setAttribute('open', ''); };
      for (const name of globals) Object.defineProperty(globalThis, name, {configurable: true, writable: true, value: name === 'window' ? window : window[name]});
      const first = initial.s;
      let visit = true, rev = 0, gen = 0, edits = 0, serial = 0, refSerial = first.refSerial, views = 0, cancels = 0, maintains = 0;
      let pending, changed = false, selection = 0, retaining = 0, dialog, statusLine;
      const issued = new Set(), forgotten = new Set(), leaked = new Set(), refs = new Set(first.refs);
      const notes = {open: 'note-1', list: [{id: 'note-1', kind: 'text', title: 'Note', body: 'Body',
        ...(first.link ? {documentSource: link(first.link, first.linkRef)} : {})}]};
      const wait = stage => new Promise((resolve, reject) => { assert.equal(pending, undefined, `${stage} while ${pending?.stage} waits`);pending = {stage, resolve, reject}; });
      const answer = () => { const call = pending;pending = undefined;return call; };
      globalThis.__alphaNoteSourcePorts = {
        daily(name, input) {
          if (name === 'perform') return wait('pick');
          assert.equal(name, 'forgetSelected');
          return wait('release').then(() => { forgotten.add(input.selectionId); });
        },
        attachments(name, input) {
          if (name === 'readSelected') return wait('read');
          if (name === 'retainSourceReference') return wait('retain');
          if (name === 'openReviewed') { views++;return wait('view'); }
          if (name === 'openSourceReference') { views++;return wait('linked'); }
          if (name === 'cancel') { cancels++;return Promise.resolve(); }
          assert.equal(name, 'releaseSourceReferences');
          // References named by a note stay; one retained by the action in flight is inside the grace period.
          for (const id of [...refs]) if (!input.keep.includes(reference(id)) && id !== retaining) refs.delete(id);
          return Promise.resolve({removed: 0, released: 0, remaining: refs.size});
        },
        review: file => ({sha256: changed ? digest(9) : file.sha256, size: file.size}),
      };
      const api = {isActive: () => visit, get: () => notes, notesTrash: {maintain() { maintains++; }},
        saveImportedNote: patch => wait('save').then(stored => { if (stored) { notes.list = patch.list;rev++; } return stored; })};
      const views_ = {notes: {render: () => ({}), onLeave() {}}};
      product.installNoteSourceAdapter(views_);
      const button = index => dialog.querySelectorAll('.note-source-options button')[index];
      const press = index => async () => { button(index).click();await settle(); };
      const done = () => { selection = 0;retaining = 0; };
      return {
        actions: {
          async openDialog() {
            views_.notes.render(notes, api).sourceDocument();gen++;
            dialog = window.document.querySelector('dialog');statusLine = dialog.querySelector('[role="status"]');await settle();
          },
          async closeDialog() { dialog.querySelector('footer button').click();await settle(); },
          async leaveNotes() { visit = false;views_.notes.onLeave(api);await settle(); },
          enterNotes() { visit = true; },
          outsideEdit() { edits++;rev++;notes.list = notes.list.map(note => ({...note, body: `Edited ${edits}`})); },
          async choose({mode}) { await press(mode === 'link' ? 1 : 2)(); },
          remove: press(3), openLinked: press(0),
          async pickSettles({result}) {
            if (result === 'selected') { selection = ++serial;issued.add(`sel-${selection}`); }
            answer().resolve(result === 'selected' ? {status: 'selected', selectionId: `sel-${selection}`} : {status: result === 'cancelled' ? 'cancelled' : 'failed'});
            await settle();if (!pending) done();
          },
          async readSettles({read, versioned}) {
            const file = read === 'two' ? 2 : 1;changed = read === 'changed';
            if (read === 'failed') answer().reject(Error('The selected file could not be read.'));
            else answer().resolve({name: `file-${file}.txt`, mimeType: 'text/plain', dataBase64: 'AA==', sha256: digest(file), size: 2048 * file, ...(versioned ? {sourceReferenceVersion: 1} : {})});
            await settle();changed = false;
          },
          async retainSettles({ok}) {
            if (ok) { retaining = ++refSerial;refs.add(retaining);answer().resolve({reference: reference(retaining)}); }
            else answer().reject(Error('The reference could not be retained.'));
            await settle();
          },
          async saveSettles({ok}) { answer().resolve(ok);await settle();if (!pending) done(); },
          async viewSettles({ok}) { if (ok) answer().resolve({message: 'Opened.'});else answer().reject(Error('No viewer.'));await settle(); },
          async linkedSettles({ok}) { if (ok) answer().resolve({message: 'Opened.'});else answer().reject(Error('No viewer.'));await settle();done(); },
          async releaseSettles({ok}) {
            if (ok) answer().resolve();else { leaked.add(`sel-${selection}`);answer().reject(Error('The picker kept the selection.')); }
            await settle();done();
          },
          async maintain() { await product.releaseUnusedSourceReferences(notes.list); },
        },
        observe() {
          const stored = notes.list[0].documentSource, open = !!dialog?.isConnected, stage = pending?.stage ?? 'none';
          const ids = set => [...set].map(id => Number(id.slice(4))).sort((a, b) => a - b);
          const paragraphs = dialog ? [...dialog.querySelectorAll('.note-source-content > p')] : [];
          const name = paragraphs[0]?.textContent ?? '';
          return {visit, rev, link: stored ? Number(stored.name.slice(5, 6)) : 0, linkRef: referenceId(stored?.reference), gen, open,
            shown: open && stage === 'none' ? {source: name === 'No source linked' ? 0 : Number(name.slice(5, 6)), referenced: !button(0).hidden} : null,
            status: statusLine ? statuses.find(([pattern]) => pattern.test(statusLine.textContent))[1] : 'none', stage, serial,
            grants: ids([...issued].filter(id => !forgotten.has(id))), leaked: ids(leaked), refSerial, refs: [...refs].sort((a, b) => a - b),
            edits, views, cancels, maintains};
        },
        close() {
          for (const [name, descriptor] of Object.entries(saved)) if (descriptor) Object.defineProperty(globalThis, name, descriptor);else delete globalThis[name];
          delete globalThis.__alphaNoteSourcePorts;window.close();
        },
      };
    },
  });
}
