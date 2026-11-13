import {expect,type JSHandle,type Page} from '@playwright/test';

/** Isolated development-controller entry for fixtures that retain the current app context.
 * The product's visible route is Settings → About → Connection help. Production navigation
 * fixtures use that route; this helper adds no production hook. */
export async function openConnectionDiagnostics(page:Page){
 // The mounted connection component owns startup. Observe its settled snapshot instead of
 // returning that long-lived startup promise across the browser protocol while it is replaced.
 let controller:JSHandle<any>|undefined,finished=false;
 try{
  await expect.poll(async()=>{
   const current=controller??await page.evaluateHandle(async()=>{
    const {connectionController}=await import('/src/runtime/connection-ui.tsx');
    return connectionController;
   });
   // Acquisition shares the startup deadline; a late result still releases its handle.
   if(finished){await current.dispose();return false;}
   controller=current;
   return current.evaluate(value=>value.getSnapshot().startupResolved);
  },{timeout:15_000}).toBe(true);
  // Keep the controller retained and dispatch synchronously: opening the React sheet must not
  // leave an async evaluation promise for the browser protocol to retain during the update.
  await controller!.evaluate(value=>value.open());
 }finally{finished=true;await controller?.dispose();}
}
