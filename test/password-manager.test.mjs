import test, {mock} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';const stubs={
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
async function mount({selected='none',damaged=false}={}){
 const calls=[],fail={};let unlocked=false;
 const entry={id:'e1',label:'Shop',username:'sam@example.test',updatedAt:1,bindings:[{kind:'web',facet:'https://shop.example.test',display:'shop.example.test'}]};
 const reject=name=>{const error=fail[name];if(error){delete fail[name];throw error;}};
 globalThis.__passwordVault={
  async status(){calls.push(['status']);return {available:true,locked:!unlocked,unlockRemainingMs:unlocked?58_000:0,unlockSeconds:58,biometric:true,autofill:{supported:true,selected}};},
  async unlock(){calls.push(['unlock']);reject('unlock');unlocked=true;return {unlocked:true,unlockRemainingMs:58_000};},
  async lock(){calls.push(['lock']);unlocked=false;return {locked:true};},
  async list(){calls.push(['list']);if(damaged){unlocked=false;throw Object.assign(Error('The vault key changed'),{code:'key-invalidated'});}return {entries:[entry]};},
  async remove(input){calls.push(['remove',input]);return {removed:true};},
  async reset(){calls.push(['reset']);damaged=false;return {reset:true};},
  async save(input){calls.push(['save',input]);reject('save');return {id:input.id||'e2'};},
  async copy(input){calls.push(['copy',input]);reject('copy');return {copied:true,clearsAfterMs:45_000};},
  async reveal(input){calls.push(['reveal',input]);reject('reveal');return {shown:true,hidesAfterMs:30_000};},
  async openAutofillSettings(){calls.push(['openAutofillSettings']);return {status:'opened',destination:'autofill-picker'};},
 };
 // A path specifier: Bun returns the cached module for a file: URL that differs only in its query.
 const pm=mounted=await import(file+'?load='+(++loads));
 const toasts=[],pages=[];
 const helpers={info:(label,val)=>({kInfo:true,label,val}),group:rows=>({rows}),toast:m=>toasts.push(m),set:p=>pages.push(p.page),ic:{}};
 const rows=groups=>groups.flatMap(g=>g.rows||[]);
 const manager=()=>rows(pm.passwordManagerGroups(helpers));
 const entryPage=()=>pm.passwordEntryPage(helpers,()=>pages.push('back'));
 const find=(list,label)=>{const row=list.find(r=>r.label===label);assert.ok(row,`row ${label} in ${list.map(r=>r.label).join(', ')}`);return row;};
 const type=(label,value)=>find(rows(entryPage().groups),label).change({target:{value}});
 const press=async(list,label)=>{find(list,label).go();await settle();};
 const openShop=async()=>{manager();await settle();await press(manager(),'Unlock');await press(manager(),'Shop');};
 const hold=method=>{
  const bridge=globalThis.__passwordVault,original=bridge[method];let release,started;
  const waiting=new Promise(resolve=>{started=resolve;});
  bridge[method]=async(...args)=>{bridge[method]=original;const value=await original(...args);started();return new Promise(resolve=>{release=()=>resolve(value);});};
  return {waiting,release:()=>release()};
 };
 return {pm,calls,fail,toasts,pages,manager,entryPage,rows,find,type,press,openShop,hold,setLocked:()=>{unlocked=false;}};
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
 t.manager();await settle();assert.ok(t.toasts.includes('Saved'));
});

test('unlock expiry hides the draft, restores it after a fresh unlock and refuses an empty Save',async()=>{
 mock.timers.enable({apis:['setTimeout']});
 try{
  const t=await mount();await t.openShop();
  t.type('Name','Shop renamed');t.type('Password','typed-before-expiry');
  t.setLocked();mock.timers.tick(58_000);await settle();
  const locked=t.entryPage();
  assert.equal(locked.title,'Edit password');
  assert.deepEqual(t.rows(locked.groups).map(r=>[r.label,r.sub]),[['Unlock','']]);
  assert.ok(!JSON.stringify(locked).includes('Shop renamed')&&!JSON.stringify(locked).includes('sam@example.test')&&!JSON.stringify(locked).includes('typed-before-expiry'),'no field value is shown while locked');
  t.manager();await settle();assert.ok(t.toasts.includes('Locked'));
  await t.press(t.rows(locked.groups),'Unlock');
  const form=t.rows(t.entryPage().groups);
  assert.equal(t.find(form,'Name').value,'Shop renamed');assert.equal(t.find(form,'Username').value,'sam@example.test');
  assert.equal(t.find(form,'Password').value,'');assert.equal(t.find(form,'Password').ph,'Retype');
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
 t=await mount();await t.openShop();await t.press(t.manager(),'Lock');assert.equal(t.entryPage(),null);
});

test('Lock fences a list response already waiting in the renderer',async()=>{
 const t=await mount();await t.openShop();const held=t.hold('list');
 t.pm.refreshPasswordManager();await held.waiting;
 await t.press(t.manager(),'Lock');
 held.release();await settle();
 assert.equal(t.pm.passwordManagerHoldsEntries(),false);
 assert.ok(t.manager().some(row=>row.label==='Unlock'));
});

test('unlock expiry fences a delayed metadata refresh',async()=>{
 mock.timers.enable({apis:['setTimeout']});
 try{
  const t=await mount();await t.openShop();const held=t.hold('list');
  t.pm.refreshPasswordManager();await held.waiting;t.setLocked();mock.timers.tick(58_000);
  held.release();await settle();
  assert.equal(t.pm.passwordManagerHoldsEntries(),false);
  assert.equal(t.entryPage().groups[0].rows[0].label,'Unlock');
 }finally{mock.timers.reset();}
});

test('a completed removal cannot navigate or refresh after leaving Passwords',async()=>{
 const t=await mount();await t.openShop();const held=t.hold('remove');
 await t.press(t.rows(t.entryPage().groups),'Delete');
 t.find(t.rows(t.entryPage().groups),'Confirm delete').go();await held.waiting;
 t.pm.leavePasswordManager();const pages=t.pages.length,statusReads=t.calls.filter(([method])=>method==='status').length;
 held.release();await settle();
 assert.equal(t.pages.length,pages,'the old task cannot reopen Passwords');
 assert.equal(t.calls.filter(([method])=>method==='status').length,statusReads,'the old task cannot start a new refresh');
 assert.equal(t.pm.passwordManagerHoldsEntries(),false);
});

test('leaving during reset authentication never calls reset from the retired page',async()=>{
 const t=await mount({damaged:true});t.manager();await settle();await t.press(t.manager(),'Unlock');
 await t.press(t.manager(),'Reset vault');
 const held=t.hold('unlock');t.find(t.manager(),'Confirm reset').go();await held.waiting;
 t.pm.leavePasswordManager();held.release();await settle();
 assert.equal(t.calls.filter(([method])=>method==='reset').length,0);
});

test('a refresh retires the earlier reset review',async()=>{
 const t=await mount({damaged:true});t.manager();await settle();await t.press(t.manager(),'Unlock');
 await t.press(t.manager(),'Reset vault');
 t.pm.refreshPasswordManager();await settle();
 assert.ok(t.manager().some(row=>row.label==='Reset vault'));
 assert.ok(!t.manager().some(row=>row.label==='Confirm reset'));
});

test('an old task cannot block or clear the busy state of a new password visit',async()=>{
 const t=await mount();await t.openShop();const copy=t.hold('copy');
 t.find(t.rows(t.entryPage().groups),'Copy password').go();await copy.waiting;
 t.pm.leavePasswordManager();t.manager();await settle();
 const unlock=t.hold('unlock');t.find(t.manager(),'Unlock').go();await settle();
 assert.equal(t.calls.filter(([method])=>method==='unlock').length,2,'the new visit can unlock while an old callback is pending');
 await unlock.waiting;copy.release();await settle();
 assert.ok(t.manager().some(row=>row.label==='Unlocking…'));
 assert.deepEqual(t.toasts,[],'a previous visit cannot publish a copy notice');
 unlock.release();await settle();assert.ok(t.manager().some(row=>row.label==='Shop'));
});

test('a refused reset authentication needs a fresh review',async()=>{
 const t=await mount({damaged:true});t.manager();await settle();await t.press(t.manager(),'Unlock');
 await t.press(t.manager(),'Reset vault');
 t.fail.unlock=Object.assign(Error('Authentication cancelled'),{code:'cancelled'});
 await t.press(t.manager(),'Confirm reset');
 assert.ok(t.manager().some(row=>row.label==='Reset vault'));
 assert.equal(t.calls.filter(([method])=>method==='reset').length,0);
});
