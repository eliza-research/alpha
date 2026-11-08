import type {Page} from '@playwright/test';

/** Source-development fixture entry for the existing diagnostic controller.
 * Product Settings intentionally has no Agent connection or Connection help entry.
 * This adds no production hook and is never used by flag-off production tests. */
export async function openConnectionDiagnostics(page:Page){
 await page.evaluate(async()=>{
  const {connectionController}=await import('/src/runtime/connection-ui.tsx');
  await connectionController.initialize();
  connectionController.open();
 });
}
