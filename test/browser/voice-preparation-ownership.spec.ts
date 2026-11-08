import {test,expect} from '@playwright/test';
import {returnToApps} from './app-navigation';
import {openCloudPlanFromSettings} from './helpers/cloud-plan-settings';
import {cloudNotesVoiceFixture,notesRecorder,openNotesRecorder,recordAndFinish,noPhysicalOrLocalVoice} from './cloud-notes-voice-fixture';
for(const development of [false,true])test(`unsigned Cloud conversation reaches account Settings without Notes or microphone: ${development?'development':'normal'} browser`,async({page})=>{
 await page.route('**/__alpha-browser-cloud',async route=>{
  if(route.request().postDataJSON()?.operation==='signInStatus'){
   await route.fulfill({json:{active:false,inApp:true,google:false,email:true}});
   return;
  }
  await route.fallback();
 });
 const f=await cloudNotesVoiceFixture(page,false,development);await page.getByRole('button',{name:'Talk',exact:true}).click();const voice=page.getByRole('region',{name:'Voice conversation',exact:true});await expect(voice).toBeVisible();await expect(page.locator('[data-alpha-subview="notes-recorder"]')).toHaveCount(0);await expect(voice.getByRole('button',{name:'Microphone off',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:/Record without transcription|Use on-device voice|Use browser voice/})).toHaveCount(0);
 await voice.getByRole('button',{name:'Stop voice conversation',exact:true}).click();await expect(voice).toHaveCount(0);await returnToApps(page);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await openCloudPlanFromSettings(page);
 const signIn=page.getByRole('dialog',{name:'Welcome to Alpha.',exact:true});await expect(signIn).toBeVisible();await expect(signIn.getByRole('form',{name:'Sign in with email'})).toBeVisible();await noPhysicalOrLocalVoice(page);expect(await page.evaluate(()=>(window as any).cloudNotesVoice.starts)).toBe(0);expect(f.foreign).toEqual([]);
 await signIn.getByRole('button',{name:'Back',exact:true}).click();await expect(signIn).toHaveCount(0);const back=page.getByRole('button',{name:'Back to Settings',exact:true});if(await back.isVisible())await back.click();await page.getByRole('button',{name:'AI provider',exact:true}).click();await expect(page.getByRole('dialog',{name:'AI provider',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Check on-device speech',exact:true})).toHaveCount(0);await noPhysicalOrLocalVoice(page);expect(await page.evaluate(()=>(window as any).cloudNotesVoice.starts)).toBe(0);
});
test('Cloud Notes recorder supports Pause/Resume and saves without a transcription request',async({page})=>{
 const f=await cloudNotesVoiceFixture(page,true,true);await openNotesRecorder(page);const panel=notesRecorder(page),pause=panel.getByRole('button',{name:'Pause',exact:true});await expect(pause).toBeEnabled();await pause.click();const resume=panel.getByRole('button',{name:'Resume',exact:true});await expect(resume).toBeEnabled();await resume.click();
 await recordAndFinish(page);await expect(page.getByRole('button',{name:'Play recording',exact:true})).toBeVisible();expect(await page.evaluate(()=>{const f=(window as any).cloudNotesVoice;return {uploads:f.uploads,requests:f.requests.length};})).toEqual({uploads:0,requests:0});await noPhysicalOrLocalVoice(page);expect(f.foreign).toEqual([]);
});
