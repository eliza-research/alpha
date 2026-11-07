import {test,expect} from '@playwright/test';
import {cloudNotesVoiceFixture,notesRecorder,openNotesRecorder,recordAndFinish,savedVoiceNotes,noPhysicalOrLocalVoice} from './cloud-notes-voice-fixture';
for(const signed of [false,true])test(`${signed?'Cloud account':'paired agent alone'} keeps the explicit Cloud-only voice policy`,async({page})=>{
 const f=await cloudNotesVoiceFixture(page,signed,true);await page.evaluate(async()=>{const {connectionController}=await import('/src/runtime/connection-ui.tsx');connectionController.getPairedVoiceBinding=()=>({origin:'https://voice-fixture.invalid',ownerId:'fixture',sessionId:'fixture',expiresAt:Date.now()+60000});});await openNotesRecorder(page);
 if(!signed){await expect(notesRecorder(page).getByRole('alert')).toHaveText('Sign in to transcribe. The audio is kept.');expect(await page.evaluate(()=>(window as any).cloudNotesVoice.uploads)).toBe(0);}
 else{await recordAndFinish(page);await expect(page.getByRole('button',{name:'Play recording',exact:true})).toBeVisible();expect((await savedVoiceNotes(page))[0].body).toBe('Closed Cloud transcript');expect(await page.evaluate(()=>(window as any).cloudNotesVoice.paired)).toBe(0);}
 await expect(page.getByRole('button',{name:/Use development voice|Use browser voice|Transcribe on this device|Transcribe with agent Whisper/})).toHaveCount(0);await noPhysicalOrLocalVoice(page);expect(f.foreign).toEqual([]);
});
