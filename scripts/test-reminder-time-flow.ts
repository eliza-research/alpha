// Real renderer adapter -> native bridge boundary, under a controlled DST timezone.
// No Android/provider acceptance is implied by this host fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../test/support/strip-types.mjs';
process.env.TZ='America/New_York';
type ReminderRequest = {id: string; at: number};
type State = {form: ReturnType<typeof form> | null};
type RenderApi = {
 isActive: () => boolean;
 get: () => State;
 set: (patch: Partial<State>) => void;
 toast: (value: string) => void;
};
type CalendarView = {state: object; render: (state: State, api: RenderApi) => {f: {cals: unknown[]; save?: () => Promise<void>}}};
const writes: ReminderRequest[]=[];
const toasts: string[]=[];
const stored: Record<string, unknown>={};
let subscriptions=0,unsubscriptions=0;
const DailyApps={surfaceInfo:async()=>({reminderTimingVersion:2}),scheduleReminder:async (input: ReminderRequest)=>{writes.push(input);return {status:'scheduled',id:input.id};},listReminders:async()=>({reminders:writes.map(r=>({...r,status:'scheduled',occurrenceId:'fixture-occurrence'}))}),addListener:async()=>({remove(){}})};
const state: State={form:null};
class Shell{declare live: boolean; componentDidMount(){}componentWillUnmount(){}vset(){}toast(value: string){toasts.push(value);}}
const views: {calendar: CalendarView}={calendar:{state:{},render:()=>({f:{cals:[]}})}};
const source=stripTypeScriptTypes(fs.readFileSync(new URL('../apps/app/src/prototype/reminder-adapter.ts',import.meta.url),'utf8').replace(/^import .*?;\n/gm,'').replace('export function installReminderAdapter','function installReminderAdapter'));
// Exercise the actual durable creation/readback module as well as the renderer.
// The shared reminder journal is imported for real; Alpha modules are inlined into the vm
// with their journal imports and re-exports bound to it.
const journal=await import('../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-journal.ts');
const bind=(names: string)=>'{'+names.split(',').map(name=>name.trim()).filter(name=>name&&!name.startsWith('type ')).map(name=>{const [from,as=from]=name.split(/\s+as\s+/);return as===from?from:`${from}:${as}`;}).join(',')+'}';
const inline=(path: string)=>stripTypeScriptTypes(fs.readFileSync(new URL(path,import.meta.url),'utf8')
 .replace(/^import \{([^}]*)\} from '[^']*reminder-journal\.ts';\n/gm,(_,names: string)=>`var ${bind(names)}=__journal;\n`)
 .replace(/^import [\s\S]*?;\n/gm,'').replace(/^export type \{[\s\S]*?\};?\n/gm,'')
 .replace(/^export \{([^}]*)\} from '[^']*reminder-journal\.ts';\n/gm,(_,names: string)=>`var ${bind(names)}=__journal;\n`)
 .replace(/export /g,''));
const creationSource=inline('../apps/app/src/runtime/reminder-journal-store.ts')+'\n'+inline('../apps/app/src/runtime/reminder-creations.ts');
const contractSource=inline('../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-contract.ts');
const context={__journal:journal,Capacitor:{getPlatform:()=> 'android',isNativePlatform:()=>true},DailyApps,Shell,views,Date,crypto,console,TextEncoder,connectionController:{getSnapshot:()=>({open:true}),subscribe:()=>{subscriptions++;return()=>{unsubscriptions++;};}},document:{hidden:false,addEventListener(){},removeEventListener(){}},window:{addEventListener(){},removeEventListener(){}},secureConnectionStore:{read:async (key: string)=>stored[key]??null,compareExchange:async(key: string,expected: unknown,value: unknown)=>{if(JSON.stringify(stored[key]??null)!==JSON.stringify(expected))return{status:'conflict'};stored[key]=value;return{status:'saved'};}},reconcileReminderDeletions:async()=>0,rememberNoteOrigin:async()=>true,forgetNoteOrigin:async()=>{}};
vm.runInNewContext(contractSource+'\n'+creationSource+'\n'+source+'\ninstallReminderAdapter(Shell,views);',context);
const owner=new Shell();owner.live=true;owner.componentDidMount();
const api: RenderApi={isActive:()=>true,get:()=>state,set:patch=>Object.assign(state,patch),toast:value=>toasts.push(value)};
const save=()=>{
 const action=views.calendar.render(state,api).f.save;
 assert.ok(action,'Reminder form must expose Save');
 return action();
};
const today=new Date();
const year=today.getFullYear()+1;
const march=new Date(Date.UTC(year,2,1));
const secondSunday=1+(7-march.getUTCDay())%7+7;
const off=(Date.UTC(year,2,secondSunday)-Date.UTC(today.getFullYear(),today.getMonth(),today.getDate()))/86400000;
const form=(time: number)=>({title:'Disposable DST flow',notes:'',off,t:time,cal:'alpha-reminders',repeat:'none',alert:0});
state.form=form(2.5);await save();
assert.equal(writes.length,0,'Nonexistent local time must not reach native scheduling or its permission request');
assert.ok(toasts.some(t=>t.includes('Nothing was saved')));
state.form=form(3.5);await save();
assert.equal(writes.length,1);const saved=new Date(writes[0].at);assert.equal(saved.getHours(),3);assert.equal(saved.getMinutes(),30);assert.equal(saved.getDate(),secondSunday);
owner.componentWillUnmount();assert.equal(subscriptions,1);assert.equal(unsubscriptions,1,'Native chooser retry subscription must be released on teardown');
console.log('PASS real reminder adapter rejects DST-gap save before native bridge; valid neighboring wall time schedules once. Host boundary fixture only.');
