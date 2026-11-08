import {test,expect} from '@playwright/test';

test('saved development connection restores without flashing a chooser; explicit settings remain available',async({page})=>{
 await page.goto('/?mode=dev');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Agent connection',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Development connections',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Connect development profile',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Development connections',exact:true})).toHaveCount(0);
 await page.addInitScript(()=>{
  const seen:string[]=[];(window as any).startupChoosers=seen;
  new MutationObserver(()=>{for(const dialog of document.querySelectorAll('[role="dialog"]')){
   const text=dialog.textContent||'';if(/Your agent\.|Development connections/.test(text))seen.push(text.slice(0,100));
  }}).observe(document,{childList:true,subtree:true});
 });
 await page.reload();
 await expect.poll(()=>page.evaluate(async()=>{const {connectionController}=await import('/src/runtime/connection-ui.tsx');return !!connectionController.getSnapshot().session;})).toBe(true);
 expect(await page.evaluate(()=>(window as any).startupChoosers)).toEqual([]);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Agent connection',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Development connections',exact:true})).toBeVisible();
});

test('passive agent status stays quiet during startup while blocked actions retain an explanation',async({page})=>{
 await page.goto('/?mode=dev');
 const notices=await page.evaluate(async()=>{
  const ui=await import('/src/runtime/connection-ui.tsx');
  return {
   startup:ui.agentAvailabilityNotice({kind:'starting'}),
   recovery:ui.agentAvailabilityNotice({kind:'recovering'}),
   refusal:ui.agentPendingText({kind:'starting'}),
   offline:ui.agentAvailabilityNotice({kind:'offline'},'Agent connection required'),
  };
 });
 expect(notices.startup).toBe('');
 expect(notices.recovery).toContain('Retry in Settings');
 expect(notices.refusal).toContain('starting');
 expect(notices.offline).toBe('Agent connection required');
});
