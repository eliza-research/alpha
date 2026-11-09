import {expect,type Page} from '@playwright/test';

// Holds a readwrite transaction on the browser documents store so a queued calendar write waits behind it.
export async function holdDocumentsTransaction(page:Page){
 await page.evaluate(async()=>{
  const database=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('alpha.browser.documents.v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const transaction=database.transaction('documents','readwrite'),store=transaction.objectStore('documents');let holding=true;
  (window as any).releaseRecovery=()=>{holding=false;};
  (window as any).recoveryLock=new Promise<void>((resolve,reject)=>{transaction.oncomplete=()=>{database.close();resolve();};transaction.onabort=()=>{database.close();reject(transaction.error);};});
  const keepAlive=()=>{const request=store.get('calendar-recovery-transaction');request.onsuccess=()=>{(window as any).recoveryEntered=true;if(holding)keepAlive();};};keepAlive();
 });
 await expect.poll(()=>page.evaluate(()=>(window as any).recoveryEntered)).toBe(true);
 return {release:()=>page.evaluate(async()=>{(window as any).releaseRecovery();await (window as any).recoveryLock;})};
}
