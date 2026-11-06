// Settings → Password manager (password-manager.ts) against a recording vault bridge in Node.
// No Keystore, WebView or Settings template is involved: this proves the renderer's draft,
// lock and message handling, not a device unlock.
import test, {mock} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const stubs={
 '@capacitor/core':'export const Capacitor={isNativePlatform:()=>false,isPluginAvailable:()=>false};',
 '../platform-plugins':'export function registerPlugin(){return {};}',
 '../build-flags':'export const devSurfacesEnabled=true,testMocksEnabled=false;',
 '../browser/dev-profile':'export const browserDevProfile=true;',
 './dev-vault':'export function createDevelopmentVault(){return globalThis.__passwordVault;}',
};
const dir=mkdtempSync(join(tmpdir(),'password-manager-'));
const output=await build({entryPoints:[resolve('apps/app/src/passwords/password-manager.ts')],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'stubs',setup(b){b.onResolve({filter:/^(@capacitor\/core|\.\.\/platform-plugins|\.\.\/build-flags|\.\.\/browser\/dev-profile|\.\/dev-vault)$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'js'}));}}]});
const file=join(dir,'password-manager.mjs');writeFileSync(file,output.outputFiles[0].text);process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));
const listeners={};
globalThis.document={hidden:false,addEventListener:(name,f)=>{listeners[name]=f;},removeEventListener(){}};
globalThis.window={addEventListener(){},removeEventListener(){}};
const settle=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));};
let loads=0,mounted;
// Each module arms a real unlock-window timer; leaving clears it so the run ends promptly.
test.afterEach(()=>mounted?.leavePasswordManager());

/** A fresh module over a bridge that records each call; `fail` makes a method reject once. */
async function mount({selected='none'}={}){
 const calls=[],fail={};let unlocked=false;
 const entry={id:'e1',label:'Shop',username:'sam@example.test',updatedAt:1,bindings:[{kind:'web',facet:'https://shop.example.test',display:'shop.example.test'}]};
 const reject=name=>{const error=fail[name];if(error){delete fail[name];throw error;}};
 globalThis.__passwordVault={
  async status(){calls.push(['status']);return {available:true,locked:!unlocked,unlockRemainingMs:unlocked?58_000:0,unlockSeconds:58,biometric:true,autofill:{supported:true,selected}};},
  async unlock(){calls.push(['unlock']);unlocked=true;return {unlocked:true,unlockRemainingMs:58_000};},
  async lock(){calls.push(['lock']);unlocked=false;return {locked:true};},
  async list(){calls.push(['list']);return {entries:[entry]};},
  async save(input){calls.push(['save',input]);reject('save');return {id:input.id||'e2'};},
  async copy(input){calls.push(['copy',input]);reject('copy');return {copied:true,clearsAfterMs:45_000};},
  async reveal(input){calls.push(['reveal',input]);reject('reveal');return {shown:true,hidesAfterMs:30_000};},
  async openAutofillSettings(){calls.push(['openAutofillSettings']);return {status:'opened',destination:'autofill-picker'};},
 };
 const pm=mounted=await import(pathToFileURL(file).href+'?load='+(++loads));
 const toasts=[],pages=[];
 const helpers={info:(label,val)=>({kInfo:true,label,val}),group:rows=>({rows}),toast:m=>toasts.push(m),set:p=>pages.push(p.page),ic:{}};
 const rows=groups=>groups.flatMap(g=>g.rows||[]);
 const manager=()=>rows(pm.passwordManagerGroups(helpers));
 const entryPage=()=>pm.passwordEntryPage(helpers,()=>pages.push('back'));
 const find=(list,label)=>{const row=list.find(r=>r.label===label);assert.ok(row,`row ${label} in ${list.map(r=>r.label).join(', ')}`);return row;};
 const type=(label,value)=>find(rows(entryPage().groups),label).change({target:{value}});
 const press=async(list,label)=>{find(list,label).go();await settle();};
 const openShop=async()=>{manager();await settle();await press(manager(),'Unlock passwords');await press(manager(),'Shop');};
 return {pm,calls,fail,toasts,pages,manager,entryPage,rows,find,type,press,openShop,setLocked:()=>{unlocked=false;}};
}

test('a rejected save keeps the typed password, so the retry sends it',async()=>{
 const t=await mount();await t.openShop();
 t.type('Password','new-secret-1');
 t.fail.save=Object.assign(new Error('Use an HTTPS website address'),{code:'invalid'});
 await t.press(t.rows(t.entryPage().groups),'Save');
 assert.deepEqual(t.find(t.rows(t.entryPage().groups),'Not saved').val,'Use an HTTPS website address');
 assert.equal(t.find(t.rows(t.entryPage().groups),'Password').value,'new-secret-1');
 await t.press(t.rows(t.entryPage().groups),'Save');
 const saves=t.calls.filter(([m])=>m==='save');
 assert.equal(saves.length,2);assert.equal(saves[1][1].password,'new-secret-1');
 assert.equal(t.entryPage(),null,'the draft closes once saved');
 assert.ok(t.manager().some(r=>r.val==='Password saved.'));
});

test('unlock expiry hides the draft, restores it after a fresh unlock and refuses an empty Save',async()=>{
 mock.timers.enable({apis:['setTimeout']});
 try{
  const t=await mount();await t.openShop();
  t.type('Name','Shop renamed');t.type('Password','typed-before-expiry');
  t.setLocked();mock.timers.tick(58_000);await settle();
  const locked=t.entryPage();
  assert.equal(locked.title,'Edit password');
  assert.deepEqual(t.rows(locked.groups).map(r=>[r.label,r.sub]),[['Unlock passwords','Locked. Unlock to continue.']]);
  assert.ok(!JSON.stringify(locked).includes('Shop renamed')&&!JSON.stringify(locked).includes('sam@example.test')&&!JSON.stringify(locked).includes('typed-before-expiry'),'no field value is shown while locked');
  assert.ok(t.manager().some(r=>r.val==='Locked after the unlock time ended.'));
  await t.press(t.rows(locked.groups),'Unlock passwords');
  const form=t.rows(t.entryPage().groups);
  assert.equal(t.find(form,'Name').value,'Shop renamed');assert.equal(t.find(form,'Username').value,'sam@example.test');
  assert.equal(t.find(form,'Password').value,'');assert.equal(t.find(form,'Password').ph,'Type the new password again');
  await t.press(form,'Save');
  assert.equal(t.find(t.rows(t.entryPage().groups),'Not saved').val,'Type the new password again.');
  assert.ok(!t.calls.some(([m])=>m==='save'),'an empty field after expiry never keeps the old password');
  t.type('Password','typed-again');await t.press(t.rows(t.entryPage().groups),'Save');
  assert.deepEqual(t.calls.find(([m])=>m==='save')[1],{id:'e1',label:'Shop renamed',username:'sam@example.test',websites:[],keepBindings:['https://shop.example.test'],password:'typed-again'});
 }finally{mock.timers.reset();}
});

test('leaving, backgrounding and Lock still forget the draft',async()=>{
 let t=await mount();await t.openShop();t.pm.leavePasswordManager();assert.equal(t.entryPage(),null);
 t=await mount();t.pm.passwordManagerLifecycle(()=>{});await t.openShop();document.hidden=true;listeners.visibilitychange();document.hidden=false;assert.equal(t.entryPage(),null);
 t=await mount();await t.openShop();await t.press(t.manager(),'Lock passwords');assert.equal(t.entryPage(),null);
});

test('Copy and Show failures are toasted; a copy names a best-effort clear',async()=>{
 const t=await mount();await t.openShop();
 await t.press(t.rows(t.entryPage().groups),'Copy password');
 assert.deepEqual(t.toasts,['Copied. Alpha tries to clear it in 45 s.']);
 t.fail.copy=Object.assign(new Error('native detail'),{code:'unavailable'});
 await t.press(t.rows(t.entryPage().groups),'Copy password');
 t.fail.reveal=Object.assign(new Error('native detail'),{code:'cancelled'});
 await t.press(t.rows(t.entryPage().groups),'Show password');
 assert.deepEqual(t.toasts.slice(1),['Saved passwords are unavailable.','Unlock was cancelled.']);
});

test('autofill rows: browser fill state and Set offered only while Alpha is not selected',async()=>{
 let t=await mount();t.manager();await settle();
 let rows=t.manager();
 assert.deepEqual([t.find(rows,'Browser autofill').val,t.find(rows,'Browser autofill').sub],['Unavailable','Use Show or Copy for website passwords.']);
 assert.equal(t.find(rows,'Autofill service').val,'None selected');
 await t.press(rows,'Set as autofill service');
 assert.ok(t.calls.some(([m])=>m==='openAutofillSettings'));assert.deepEqual(t.toasts,[],'opening the picker is not reported as a choice');
 t=await mount({selected:'this-app'});t.manager();await settle();rows=t.manager();
 assert.equal(t.find(rows,'Autofill service').val,'Alpha Phone passwords');
 assert.ok(!rows.some(r=>r.label==='Set as autofill service'));
});
