// The real browser Calendar, Reminder and Clock code over an in-memory Documents port and jsdom.
// Only device and UI edges are replaced: the documents backend, review dialogs (always approve),
// the event editor (applies the test's fields), deletion owner, notification state and sound.
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://alpha.test/',pretendToBeVisual:true});
for(const name of ['window','document','HTMLElement','HTMLDialogElement','Event','CustomEvent','localStorage','getComputedStyle'])Object.defineProperty(globalThis,name,{value:name==='window'?dom.window:dom.window[name],configurable:true,writable:true});
globalThis.BroadcastChannel=undefined;
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
dom.window.HTMLDialogElement.prototype.close=function(){if(!this.open)return;this.open=false;this.dispatchEvent(new dom.window.Event('close'));};

export class MemoryDocuments {
 rows=new Map();writes=0;
 async read(key){return structuredClone(this.rows.get(key));}
 async readOrCreate(key,raw){if(!this.rows.has(key))return this.compareExchange(key,undefined,raw);return this.read(key);}
 async compareExchange(key,expected,raw){if(JSON.stringify(this.rows.get(key))!==JSON.stringify(expected))throw Error('Document changed');const next={revision:String(++this.writes),raw};this.rows.set(key,next);return structuredClone(next);}
 async edit(key,editor){const before=await this.read(key),next=await editor(before);await this.compareExchange(key,before,next.raw);return next.result;}
}
const harness=globalThis.__alphaTest={documents:new MemoryDocuments(),notifications:true,next:row=>row};
const stubs={
 './documents':`const d=()=>globalThis.__alphaTest.documents;export const browserDocuments={read:(...a)=>d().read(...a),readOrCreate:(...a)=>d().readOrCreate(...a),compareExchange:(...a)=>d().compareExchange(...a),edit:(...a)=>d().edit(...a)};`,
 './review':`export class BrowserReviews{async confirm(){return true;}cancel(){}}`,
 './calendar-editor':`export const editCalendarEvent=async(row,save)=>{await save(globalThis.__alphaTest.next(row),()=>true);return {status:'saved'};};`,
 './files':`export class BrowserFiles{}`,
 './notification-store':`export const notificationState=async()=>({appEnabled:globalThis.__alphaTest.notifications,channels:{}});`,
 '../runtime/deletion-owner':`export const browserDeletionOwner=()=>'agent:test',browserDeletionOwnerCurrent=()=>true,browserDeletionOwnerVisible=()=>true;`,
 './dialog-layout':`export const layoutBrowserDialog=(dialog,actions)=>dialog.append(...actions);`,
 './alert-audio':`export class BrowserAlertAudio{play(){}stop(){}}`,
 './screen-locked':`export const browserScreenLocked=()=>false;`,
 '@capacitor/core':`export class WebPlugin{async notifyListeners(){}}export const Capacitor={isNativePlatform:()=>false,getPlatform:()=>'web'};export const registerPlugin=()=>({});`,
};
const entry=`export {BrowserCalendar} from './apps/app/src/browser/calendar.ts';
export {BrowserDaily} from './apps/app/src/browser/daily.ts';
export {BrowserClock} from './apps/app/src/browser/clock.ts';
export {calendarDocument} from './apps/app/src/browser/calendar-store.ts';
export {reminderDocument} from './apps/app/src/browser/reminder-store.ts';
export {syncRecurrence} from './apps/app/src/browser/calendar-sync-fields.ts';
export {calendarRange} from './apps/app/src/browser/calendar-records.ts';`;
const bundled=(await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'neutral',format:'esm',mainFields:['module','main'],loader:{'.css':'empty'},define:{'import.meta.env':'{}'},
 plugins:[{name:'device-edges',setup(build){
  build.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'stub'}:undefined);
  build.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));
 }}]})).outputFiles[0].text;
export const modules=await import('data:text/javascript;base64,'+Buffer.from(bundled).toString('base64'));
/** A fresh, empty set of documents for one test. */
export function resetDocuments(){harness.documents=new MemoryDocuments();harness.notifications=true;harness.next=row=>row;return harness;}
export {harness};
