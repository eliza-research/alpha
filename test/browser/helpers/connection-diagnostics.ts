import {expect,type Page} from '@playwright/test';

/** Isolated development-controller entry for fixtures that retain the current app context.
 * The product's visible route is Settings → General → Agent connection. Production navigation
 * fixtures use that route; this helper adds no production hook. */
export async function openConnectionDiagnostics(page:Page){
 // The mounted connection component owns startup. Observe its settled snapshot instead of
 // returning that long-lived startup promise across the browser protocol while it is replaced.
 await expect.poll(()=>page.evaluate(async()=>{
  const {connectionController}=await import('/src/runtime/connection-ui.tsx');
  return connectionController.getSnapshot().startupResolved;
 }),{timeout:15_000}).toBe(true);
 await page.evaluate(async()=>{
  const {connectionController}=await import('/src/runtime/connection-ui.tsx');
  connectionController.open();
 });
}
