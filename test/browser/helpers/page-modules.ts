import type {Page} from '@playwright/test';
/**
 * Loads app modules into the page as a module script and waits for its load event, so a later
 * `page.evaluate(async()=>{await import(path)})` resolves from the module map at once.
 *
 * Why: Chromium's inspector holds the promise of an awaited `page.evaluate` weakly. While a
 * dynamic import inside it was still fetching or compiling a not-yet-loaded module on a busy
 * Vite server, CI saw "page.evaluate: Resulting promise was garbage collected" (chat-voice-mode
 * setup, cloud-personal-onboarding sign-in). Preloading removes that wait from the evaluate, and
 * the loaded namespaces stay referenced from `window.__alphaModules`.
 */
export async function preloadPageModules(page:Page,paths:readonly string[]){
 for(const path of paths)if(!/^\/src\/[A-Za-z0-9/_.-]+\.(ts|tsx|js)$/.test(path))throw Error('Unexpected module path');
 const content=paths.map((path,index)=>`import * as m${index} from ${JSON.stringify(path)};`).join('\n')
  +`\nwindow.__alphaModules=Object.assign(window.__alphaModules||{},{${paths.map((path,index)=>`${JSON.stringify(path)}:m${index}`).join(',')}});`;
 await page.addScriptTag({type:'module',content});
 await page.waitForFunction(paths=>paths.every(path=>!!(window as any).__alphaModules?.[path]),paths);
}
