import {selectCalendarSource} from './helpers/browser-calendar';
import {test,expect} from '@playwright/test';
// Rendered production navigation with a controlled encrypted-native boundary.
// OS delivery/process death are exercised separately by Android instrumentation.
for(const mode of ['recover','stale','read-failure','draft-race','navigation-race','queue-change','consume-failure','dismiss-stale','reload-recovery','chooser-close'] as const)test('durable reminder tap '+mode,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(mode=>{
  const w=window as any;w.androidBridge={};if(mode!=='chooser-close')localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const target={sourceId:'local-source',sourceRevision:'a'.repeat(64),reminderId:'retained-reminder',occurrenceId:'one',revision:'b'.repeat(64),timingVersion:2};
  const f=w.reminderTapFixture={mode,pending:{token:'original-token',target,retained:!['stale','dismiss-stale'].includes(mode)},consumed:[] as string[],reads:0,allow:mode==='chooser-close'||localStorage.getItem('tap-fixture-recover')==='1',release:null as any};
  const slots:Record<string,string>={};
  const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
  w.Capacitor={PluginHeaders:[
   {name:'AlphaNotifications',methods:methods(['status','crossAppStatus','addListener','removeListener'])},
   {name:'AlphaVoiceCloud',methods:methods(['checkPermissions'])},
   {name:'DailyApps',methods:methods(['surfaceInfo','pendingReminderTap','consumeReminderTap','dismissReminderTap','listReminders','addListener','removeListener'])},
   {name:'ElizaSystem',methods:methods(['getBuildInfo'])},
   {name:'AlphaConnection',methods:methods(['secureRead','secureWrite','secureCompareExchange','secureRemove','addListener','removeListener'])},
   {name:'AlphaHostedResults',methods:methods(['disableBackground','addListener','removeListener'])},
  ],nativePromise:async(plugin:string,method:string,input:any)=>{
   if(plugin==='AlphaNotifications')return {permissionGranted:true,appEnabled:true};
   if(plugin==='AlphaVoiceCloud')return {microphone:'granted'};
   if(plugin==='DailyApps'){
    if(method==='surfaceInfo')return {developmentBuild:true,assistant:false,reminderTapVersion:1};
    if(method==='pendingReminderTap'){f.reads++;return f.allow?f.pending:{};}
    if(method==='consumeReminderTap'){if(f.mode==='consume-failure')throw Error('Storage unavailable');if(f.pending.token!==input.token)throw Error('Newer tap');f.consumed.push(input.token);f.pending={};return {};}
    if(method==='dismissReminderTap'){if(f.pending.token!==input.token)throw Error('Changed');f.pending={token:'older-valid-token',target,retained:true};return {};}
    if(method==='listReminders'){
     if(f.allow&&(f.mode==='read-failure'||f.mode==='reload-recovery'&&localStorage.getItem('tap-fixture-recover')!=='1'))throw Error('Unavailable');
     if(f.allow&&['draft-race','navigation-race','queue-change'].includes(f.mode)){if(f.mode==='queue-change')f.pending={...f.pending,token:'newer-token'};else await new Promise(r=>f.release=r);}
     return {reminders:[{id:'retained-reminder',title:'Original notification reminder',body:'Exact saved body',at:Date.now(),dueAt:Date.now(),alertMinutes:0,status:'posted',occurrenceId:'one',target}]};
    }
    return {};
   }
   if(plugin==='ElizaSystem'&&method==='getBuildInfo')return {launcher:false,version:'fixture'};
   if(plugin==='AlphaConnection'){
    if(method==='secureRead')return {value:slots[input.slot]??null};
    if(method==='secureWrite'){slots[input.slot]=input.value;return {};}
    if(method==='secureRemove'){delete slots[input.slot];return {};}
    if(method==='secureCompareExchange'){
     if((slots[input.slot]??null)!==input.expectedValue)return {status:'conflict'};
     if(input.value===null)delete slots[input.slot];else slots[input.slot]=input.value;
     return {status:'saved'};
    }
   }
   return {};
  }};
 },mode);
 await page.goto('/');
 if(mode==='chooser-close'){
  // P-43: no offline choice exists; the owner closes the chooser.
  await expect(page.getByRole('button',{name:'Close connection settings',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).reminderTapFixture.consumed)).toEqual([]);
  await page.getByRole('button',{name:'Close connection settings',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Original notification reminder',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as any).reminderTapFixture.consumed)).toEqual(['original-token']);expect(errors).toEqual([]);return;
 }
 await page.getByRole('button',{name:'Calendar',exact:true}).click();
 if(mode==='draft-race'){
  await selectCalendarSource(page, 'Android calendars');
 }
 await page.evaluate(()=>{(window as any).reminderTapFixture.allow=true;document.dispatchEvent(new Event('visibilitychange'));});
 if(mode==='reload-recovery'){
  await expect(page.getByRole('button',{name:'Open saved reminder notification',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).reminderTapFixture.consumed)).toEqual([]);
  await page.evaluate(()=>localStorage.setItem('tap-fixture-recover','1'));await page.reload();
  await expect(page.getByRole('heading',{name:'Original notification reminder',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as any).reminderTapFixture.consumed)).toEqual(['original-token']);
  expect(errors).toEqual([]);return;
 }
 if(mode==='dismiss-stale'){
  const dismiss=page.getByRole('button',{name:'Dismiss saved reminder link',exact:true});await expect(dismiss).toBeVisible();
  page.once('dialog',d=>void d.dismiss());await dismiss.click();expect(await page.evaluate(()=>(window as any).reminderTapFixture.pending.token)).toBe('original-token');
  page.once('dialog',d=>void d.accept());await dismiss.click();await expect.poll(()=>page.evaluate(()=>(window as any).reminderTapFixture.pending.token)).toBe('older-valid-token');
  await expect(page.getByRole('heading',{name:'Original notification reminder',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Open saved reminder notification',exact:true}).click();await expect(page.getByRole('heading',{name:'Original notification reminder',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as any).reminderTapFixture.consumed)).toEqual(['older-valid-token']);expect(errors).toEqual([]);return;
 }
 if(mode==='draft-race'||mode==='navigation-race'){
  await expect.poll(()=>page.evaluate(()=>typeof(window as any).reminderTapFixture.release)).toBe('function');
  if(mode==='draft-race'){await page.getByRole('button',{name:'New event',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('New draft survives');}else await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));
  await page.evaluate(()=>(window as any).reminderTapFixture.release());
  if(mode==='draft-race')await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('New draft survives');else await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
 }else if(mode==='recover'||mode==='consume-failure'){
  await expect(page.getByRole('heading',{name:'Original notification reminder',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Complete reminder occurrence',exact:true})).toBeVisible();await expect(page.locator('body')).toContainText('Exact saved body');
  if(mode==='recover')await expect.poll(()=>page.evaluate(()=>(window as any).reminderTapFixture.consumed)).toEqual(['original-token']);
 }else await expect.poll(()=>page.evaluate(()=>(window as any).reminderTapFixture.reads)).toBeGreaterThan(1);
 if(mode!=='recover')expect(await page.evaluate(()=>(window as any).reminderTapFixture.consumed)).toEqual([]);
 expect(errors).toEqual([]);
});
