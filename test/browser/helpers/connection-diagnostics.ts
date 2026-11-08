import type {Page} from '@playwright/test';

/** Isolated development-controller entry for fixtures that retain the current app context.
 * The product's visible route is Settings → About → Connection help. Production navigation
 * fixtures use that route; this helper adds no production hook. */
export async function openConnectionDiagnostics(page:Page){
 await page.evaluate(async()=>{
  const {connectionController}=await import('/src/runtime/connection-ui.tsx');
  await connectionController.initialize();
  connectionController.open();
 });
}
