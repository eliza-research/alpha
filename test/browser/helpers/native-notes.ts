import {expect,type Page} from '@playwright/test';
import {harness} from '../flag-off-android';
import {selectLegacyNotes} from './legacy-notes';
/** A synthetic retained native document, explicitly selected; no agent Notes fallback. */
export async function openRetainedNativeNotes(page:Page){
 await harness(page,f=>{
  const key='notes-records:v1:device';
  if(!f.slots[key])f.slots[key]=JSON.stringify({version:1,archive:{v1:null,v2:null,daily:null},currentRaw:JSON.stringify({version:2,collectionId:crypto.randomUUID(),records:[],deleted:[]})});
 });
 await selectLegacyNotes(page);
 await expect(page.getByRole('heading',{name:'Older notes',exact:true})).toBeVisible();
 await expect(page.getByText('Note text encrypted on this device',{exact:true})).toBeVisible();
}
