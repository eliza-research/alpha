import {test,expect} from '@playwright/test';
for(const name of ['calendar','reminders'] as const)for(const event of ['alpha:device-state','alpha:dev-incoming-call'])for(const phase of ['capture','reset']){
 test(`${name} recovery cancels delayed ${phase} on ${event}`,async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
  await page.goto('/');
  await page.evaluate(async({name,phase})=>{
   const {openDomainRecovery}=await import('/src/browser/domain-recovery.ts');
   const recovery={snapshot:undefined,legacy:'original',raw:'original',format:'domain' as const,legacyChanged:false};
   const pending=(signal?:AbortSignal)=>new Promise<any>(resolve=>{(window as any).recoverySignal=signal;(window as any).releaseRecovery=()=>resolve(recovery);});
   openDomainRecovery({capture:signal=>phase==='capture'?pending(signal):Promise.resolve(recovery),reset:(_,signal)=>new Promise<void>((resolve,reject)=>{(window as any).recoverySignal=signal;(window as any).releaseRecovery=()=>{if(signal?.aborted)reject(signal.reason);else resolve();};})},name,'Recovery lifecycle','Test recovery');
  },{name,phase});
  if(phase==='reset'){
   await page.getByRole('button',{name:`Reset app ${name}`,exact:true}).click();
   await page.getByRole('button',{name:`Confirm ${name} reset`,exact:true}).click();
  }
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).recoverySignal))).toBe(true);
  await page.evaluate(event=>window.dispatchEvent(new Event(event)),event);
  expect(await page.evaluate(()=>(window as any).recoverySignal.aborted)).toBe(true);
  // The retired read settles; two frames later a dialog it reopened would be on screen.
  await page.evaluate(()=>{(window as any).releaseRecovery();return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  await expect(page.getByRole('dialog',{name:'Recovery lifecycle'})).toHaveCount(0);
  // A retired read must not reopen its dialog or prevent another recovery session.
  await page.evaluate(async()=>{const {openCalendarRecovery}=await import('/src/browser/calendar-recovery.ts');openCalendarRecovery();});
  await expect(page.getByRole('dialog',{name:'App calendar recovery'})).toBeVisible();
 });
}
