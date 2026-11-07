import {test,expect,type Page} from '@playwright/test';
import {openLegacyNotes} from './helpers/legacy-notes';
const recorder=(page:Page)=>page.locator('[data-alpha-subview="notes-recorder"]');

// Main uses Cloud speech. Legacy persisted local preferences cannot silently select a
// different route. The Cloud binding is synthetic; no request or capture is made.
// The development server is shared and slow on a loaded machine.
test.describe.configure({timeout:120000});
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));});
async function signedInCloud(page:Page){
 await page.evaluate(async()=>{
  const {connectionController}=await import('/src/runtime/connection-ui.tsx');
  (connectionController as any).getCloudEnvironment=()=>'production';
  (connectionController as any).getCloudClient=()=>({client:{},sessionId:'synthetic-cloud-session',credentialId:'synthetic-credential'});
 });
}
async function openRecorder(page:Page){
 await openLegacyNotes(page);
 await page.getByRole('button',{name:'Record and transcribe',exact:true}).click();
 await expect(recorder(page)).toBeVisible();
}
test('Cloud remains the Notes transcription route across reload and legacy local preferences cannot silently switch routes',async({page})=>{
 const cloud:string[]=[];page.on('request',request=>{if(/elizacloud|eliza\.how|\/api\/v1\//.test(request.url()))cloud.push(request.url());});
 const route=()=>page.evaluate(async()=>{const {noteSegmentTranscriber}=await import('/src/runtime/note-recorder-driver.ts');try{return (await noteSegmentTranscriber(new AbortController().signal))?.provenance.route??null;}catch(error:any){return error.code;}});
 await page.goto('/');await signedInCloud(page);await openRecorder(page);
 expect(await route()).toBe('eliza-cloud');
 await expect(page.getByRole('button',{name:/Use Eliza Cloud voice|Use on-device voice/})).toHaveCount(0);
 await page.evaluate(()=>localStorage.setItem('alphaphone:voice-route:v1',JSON.stringify({version:1,route:'device',chosenAt:1})));
 await page.reload();await signedInCloud(page);
 expect(await route()).toBe('eliza-cloud');
 await page.reload();
 expect(await route()).toBe('sign-in');
 expect(cloud).toEqual([]);
});
