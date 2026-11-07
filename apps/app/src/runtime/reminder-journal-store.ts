import {Capacitor} from '@capacitor/core';
import {secureConnectionStore} from './native-connection';
import type {ReminderJournalStore} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-journal.ts';
type BrowserDocument={readJson<T>():Promise<T|null>;editJson<T>(update:(raw:T|null)=>T|null):Promise<unknown>};
/**
 * Binds a shared reminder journal to Alpha's installed storage: one compare-and-set
 * secure slot on Android, and the named browser document elsewhere.
 */
export function reminderJournalStore<T>(slot:string,browser:()=>Promise<BrowserDocument>):ReminderJournalStore<T>{
 const android=()=>Capacitor.getPlatform()==='android';
 return {
  async read(){return android()?secureConnectionStore.read<T>(slot):(await browser()).readJson<T>();},
  async edit(update){
   if(!android()){await (await browser()).editJson<T>(update);return;}
   const raw=await secureConnectionStore.read<T>(slot),next=update(raw);
   if(next===raw)return;
   if((await secureConnectionStore.compareExchange(slot,raw,next)).status!=='saved')throw Error('Reminder journal changed');
  },
 };
}
