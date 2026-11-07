import {test,expect} from '@playwright/test';
import {startHostedServer,hostedFixture,hostedDevice as device,hostedPanel as panel,type HostedServer} from './hosted-harness';

test.describe.configure({mode:'serial'});
let server:HostedServer;
test.beforeAll(async()=>{server=await startHostedServer();});
test.afterAll(async()=>{await server?.close();});
const fixture=(page:any)=>hostedFixture(page,server.origin);
test('connected browser saves before notification, opens retained output, toggles preferences and restores after reload',async({page},info)=>{
 const {f,cleanup}=await fixture(page);try{
  await device(page,'Notifications');await page.getByText('Scheduled digest',{exact:true}).click();await expect(panel(page)).toContainText('Retained morning briefing');await expect(panel(page)).toContainText('Opened from notification');await page.screenshot({path:info.outputPath('hosted-browser-panel.png')});
  const toggle=panel(page).getByRole('button',{name:'Result notifications',exact:true});await expect(toggle).toHaveAttribute('aria-pressed','true');await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','false');await panel(page).getByRole('button',{name:'Pause result checks',exact:true}).click();await expect(panel(page).getByRole('button',{name:'Enable result checks',exact:true})).toBeVisible();await page.reload();
  await page.evaluate(()=>window.dispatchEvent(new Event('alpha:hosted-digests')));await expect(panel(page)).toContainText('Retained morning briefing');await expect(panel(page).getByRole('button',{name:'Result notifications',exact:true})).toHaveAttribute('aria-pressed','false');await expect(panel(page).getByRole('button',{name:'Enable result checks',exact:true})).toBeVisible();expect(f.acked).toBe(1);
  await panel(page).getByRole('button',{name:'Close scheduled digests',exact:true}).click();await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:/Agent connection/}).click();await page.getByRole('button',{name:'Disconnect agent',exact:true}).click();await expect(page.getByText('Agent disconnected.',{exact:true})).toBeVisible();const status=await page.evaluate(async()=>{const {browserHostedResults}=await import('/src/browser/hosted-results.ts');return browserHostedResults.status();});expect(status.backgroundEnabled).toBe(false);
 }finally{await cleanup();}
});
test('a delayed result tap stays pending while the simulated device is locked and resumes after unlock',async({page})=>{
 const {f,cleanup}=await fixture(page);try{await device(page,'Notifications');f.hold=true;await page.getByText('Scheduled digest',{exact:true}).click();await expect.poll(()=>!!f.release).toBe(true);await device(page,'Power');f.hold=false;f.release!();await expect(panel(page)).toHaveCount(0);await device(page,'Unlock');await expect(panel(page)).toContainText('Retained morning briefing');await expect(panel(page)).toContainText('Opened from notification');}finally{await cleanup();}
});

test('turning notifications off suppresses new result notices while retaining their output',async({page})=>{
 const {f,cleanup}=await fixture(page);try{await page.evaluate(()=>window.dispatchEvent(new Event('alpha:hosted-digests')));const toggle=panel(page).getByRole('button',{name:'Result notifications',exact:true});await expect(toggle).toHaveAttribute('aria-pressed','true');await toggle.click();f.result={...f.result,cursor:2,runId:'run-two',output:'Second saved briefing'};await panel(page).getByRole('button',{name:'Refresh',exact:true}).click();await expect(panel(page)).toContainText('Second saved briefing');expect(f.acked).toBe(2);const rows=await page.evaluate(async()=>{const {browserHostedResults}=await import('/src/browser/hosted-results.ts');return browserHostedResults.list();});expect(rows).toEqual([]);await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','true');const enabled=await page.evaluate(async()=>{const {browserHostedResults}=await import('/src/browser/hosted-results.ts');return browserHostedResults.list();});expect(enabled).toHaveLength(1); // The earlier active notice returns; the denied new result is not replayed.
 }finally{await cleanup();}
});

test('paused periodic checks stay quiet and enabling checks fetches the next retained result',async({page})=>{
 await page.clock.install();const {f,cleanup}=await fixture(page);try{await page.evaluate(()=>window.dispatchEvent(new Event('alpha:hosted-digests')));await expect(panel(page)).toContainText('Synced with this agent.');await panel(page).getByRole('button',{name:'Pause result checks',exact:true}).click();await expect(panel(page).getByRole('button',{name:'Enable result checks',exact:true})).toBeVisible();const before=f.syncs;f.result={...f.result,cursor:2,runId:'run-two',output:'Periodic result'};await page.clock.runFor(16000);expect(f.syncs).toBe(before);expect(f.acked).toBe(1);await panel(page).getByRole('button',{name:'Enable result checks',exact:true}).click();await page.clock.runFor(16000);await expect(panel(page)).toContainText('Periodic result');expect(f.acked).toBe(2);
 }finally{await cleanup();}
});
