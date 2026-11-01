import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {policyFixture as fixture} from './fixtures/device-action-policy.mjs';
test('only current-request proposals execute; old, unbound and workflow stay pending',async()=>{const f=fixture([['old','previous'],['unbound',undefined],['current','request'],['workflow','request',{}]]);await f.performRequested('request',{},new AbortController().signal,async()=>true);assert.deepEqual(f.calls,['current']);});
test('ask-first preference executes nothing',async()=>{const f=fixture([['current','request']]);await f.performRequested('request',{},new AbortController().signal,async()=>false);assert.deepEqual(f.calls,[]);});
test('preference is rechecked before each action',async()=>{const f=fixture([['one','request'],['two','request']]);let n=0;await f.performRequested('request',{},new AbortController().signal,async()=>++n===1);assert.deepEqual(f.calls,['one']);});
test('uncertain outcome stops the batch without retrying',async()=>{const f=fixture([['one','request'],['two','request']],'unknown');await f.performRequested('request',{},new AbortController().signal,async()=>true);assert.deepEqual(f.calls,['one']);});
test('cancelled request dispatches nothing',async()=>{const f=fixture([['one','request']]);const c=new AbortController();c.abort();await assert.rejects(f.performRequested('request',{},c.signal,async()=>true));assert.deepEqual(f.calls,[]);});
test('action preference defaults to direct requests and persists old preferences compatibly',()=>{const source=readFileSync('apps/app/src/browser/device-preferences.ts','utf8');const first=source.slice(source.indexOf('export const initialDevicePreferences'),source.indexOf('let cached:')).replace(/export /g,'');const stripped=stripTypeScriptTypes(first,{mode:'transform'});const c=vm.createContext({});vm.runInContext(stripped+';globalThis.initial=initialDevicePreferences;globalThis.validatePreferences=validate;',c);assert.equal(c.initial().askBeforeAgentActions,false);assert.equal(c.initial().agentGmailChanges,true);assert.equal(c.initial().agentCalendarEdits,true);assert.equal(c.validatePreferences({}).agentGmailChanges,true);assert.equal(c.validatePreferences({agentGmailChanges:false}).agentGmailChanges,false);assert.equal(c.validatePreferences({}).askBeforeAgentActions,false);assert.equal(c.validatePreferences({askBeforeAgentActions:true}).askBeforeAgentActions,true);assert.throws(()=>c.validatePreferences({askBeforeAgentActions:'yes'}));});

test('Home native destinations remain discoverable before optional domain plugins load',()=>{const rows=JSON.parse(readFileSync('config/native-view-declarations.json','utf8'));for(const id of ['camera','maps','photos','notes','calendar','inbox']){const row=rows.find(row=>row.id===id);assert.equal(row.path,'/'+id);assert.ok(row.fallbackFor);assert.equal(row.capabilities,undefined,'Navigation declaration must not invent device capabilities');}assert.equal(new Set(rows.map(x=>x.id)).size,rows.length);});

test('direct requests retain review for destructive, private and external operations',async()=>{
 const types=['sms_send','notes_delete','notes_update','notes_read_selected','notes_query','calendar_create_local','calendar_create','calendar_update','calendar_delete','calendar_named','reminder_create','create_reminder','reminder_update','reminder_delete','reminder_named','photo_library_review','maps_read_selected','future_operation'];
 const f=fixture(types.map(type=>[type,'request',undefined,type]));
 await f.performRequested('request',{},new AbortController().signal,async()=>true);
 assert.deepEqual(f.calls,[]);assert.equal(f.proposals.size,types.length,'protected proposals remain available for explicit review');
});
test('only the enumerated reversible local actions can run directly',async()=>{
 const types=['create_note','open_view','browser_navigate','camera_capture_photo','photo_library_select'];
 const f=fixture(types.map(type=>[type,'request',undefined,type]));
 await f.performRequested('request',{},new AbortController().signal,async()=>true,undefined,{messageId:'request',text:'Open https://example.com/',current:()=>{}});
 assert.deepEqual(f.calls,types.slice(0,4),'the existing four-action batch cap remains in force');
 const last=fixture([['photo_library_select','request',undefined,'photo_library_select']]);await last.performRequested('request',{},new AbortController().signal,async()=>true);assert.deepEqual(last.calls,['photo_library_select']);
});

test('navigation-only cards never auto-execute',async()=>{const f=fixture([['current','request']]);f.card=()=>({reviewDestination:'notes'});await f.performRequested('request',{},new AbortController().signal,async()=>true);assert.deepEqual(f.calls,[]);});

test('ordinary browser navigation reuses current-request execution and still respects ask-first',async()=>{
 const rows=[['old','old',undefined,'browser_navigate'],['unbound',undefined,undefined,'browser_navigate'],['current','request',undefined,'browser_navigate'],['workflow','request',{},'browser_navigate']];
 const direct=fixture(rows);await direct.performRequested('request',{},new AbortController().signal,async()=>true,undefined,{messageId:'request',text:'Open https://example.com/',current:()=>{}});assert.deepEqual(direct.calls,['current']);
 const reviewed=fixture(rows);await reviewed.performRequested('request',{},new AbortController().signal,async()=>false,undefined,{messageId:'request',text:'Open https://example.com/',current:()=>{}});assert.deepEqual(reviewed.calls,[]);
});
