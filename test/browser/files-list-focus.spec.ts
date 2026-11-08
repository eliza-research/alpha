import {test, expect, type Page} from '@playwright/test';
import {captureInputs, checkTraces, qset} from '../../specs/quint/refinement/check-traces.mjs';

const sources = ['apps/app/src/prototype/files-tree-adapter.ts', 'apps/app/src/prototype/files-index.ts',
  'apps/app/src/prototype/model.js', 'apps/app/src/prototype/template.html', 'apps/app/src/prototype/dc-lite.js',
  'apps/app/src/prototype/selection-adapter.ts', 'apps/app/src/browser/files.ts',
  'test/browser/files-list-focus.spec.ts'];

async function importRecent(page: Page, name: string) {
  await page.evaluate(async name => {
    const {registerPlugin} = await import('/src/platform-plugins.ts');
    const {filesIndex} = await import('/src/prototype/files-index.ts');
    const selected = await registerPlugin<any>('AlphaFiles').importFile(new File([name+' payload'],name,{type:'text/plain'}));
    filesIndex.record({kind:'selected',name:selected.name,mimeType:selected.mimeType,selectionId:selected.selectionId});
  },name);
}

async function rows(page: Page) {
  return page.evaluate(() => {
    const names = ['one.txt','two.txt','three.txt'];
    const id = (label: string | null) => names.findIndex(name => label === 'Open '+name) + 1;
    const region = document.querySelector('[data-alpha-subview="files-folder"] .scr') || document.querySelector('[data-alpha-app-scroll="files"]');
    const shown = [...(region?.querySelectorAll('button') || [])].map(button => id(button.getAttribute('aria-label'))).filter(Boolean);
    const focused = id(document.activeElement?.getAttribute('aria-label') ?? null);
    const name = document.querySelector('[data-alpha-subview="files-preview"] button[aria-label="Rename"] span')?.textContent;
    return {shown,focused,activated:names.indexOf(name || '')+1};
  });
}

test('new Recent metadata keeps the focused file and opens that same selection', async ({page},info) => {
  test.setTimeout(120000);
  const driverHashes = captureInputs(sources);
  await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
  await page.goto('/');
  await importRecent(page,'one.txt');
  await importRecent(page,'two.txt');
  let intent = 0;
  const observe = async () => {
    const actual = await rows(page);
    return {'s.visibleRows':qset(actual.shown),'s.focusedRow':actual.focused,
      's.intendedRow':intent,'s.activatedRow':actual.activated};
  };
  const trace = {name:'recent-prefix-keeps-focused-file',init:{name:'init'},expect:await observe(),steps:[] as any[]};
  await page.getByRole('button',{name:'Files',exact:true}).click();
  const selected = page.getByRole('button',{name:'Open one.txt',exact:true});
  await expect(selected).toBeVisible();
  trace.steps.push({label:'render two actual Recent records',action:{name:'renderRows',args:[qset([1,2])]},expect:await observe()});
  await selected.focus();
  intent = (await rows(page)).focused;
  await page.evaluate(() => (window as any).originalRecentFile = document.activeElement);
  trace.steps.push({label:'focus actual first file selection',action:{name:'focusRow',args:[intent]},expect:await observe()});
  await importRecent(page,'three.txt');
  // The source record arrives independently. Request the same renderer update
  // that consumes live Recent metadata without moving keyboard focus.
  await page.evaluate(() => {
    const screen = document.querySelector('[data-screen]') as any;
    const key = Object.keys(screen).find(name => name.startsWith('__reactFiber$'))!;
    let fiber = screen[key];
    while(fiber && !(fiber.stateNode && typeof fiber.stateNode.vget==='function'))fiber=fiber.return;
    fiber.stateNode.setState({});
  });
  await expect(page.getByRole('button',{name:'Open three.txt',exact:true})).toBeVisible();
  await expect(selected).toBeFocused();
  expect(await selected.evaluate(element => element === (window as any).originalRecentFile)).toBe(true);
  trace.steps.push({label:'prepend newly imported Recent selection',action:{name:'renderRows',args:[qset([1,2,3])]},expect:await observe()});
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-alpha-subview="files-preview"]')).toBeVisible();
  await expect(page.locator('[data-alpha-subview="files-preview"]')).toContainText('one.txt payload');
  intent = 0;
  trace.steps.push({label:'activate retained file row',action:{name:'activateRow'},expect:await observe()});
  const receipt = await checkTraces({model:'FilesTree',id:'FilesRecentFocus',sources,driverHashes,traces:[trace],
    scope:'bounded-orchestration',assumptions:[
      'Real browser file imports, Recent metadata, renderer and selected-document handler execute with three local synthetic text files.',
      'Only presentation row identity and activation target are projected. This trace does not infer native tree authority or cover provider mutation outcomes.',
    ]});
  expect(receipt.passed).toBe(true);
  await info.attach('quint-refinement-receipt',{body:JSON.stringify(receipt),contentType:'application/json'});
});

test('sorting a loaded folder keeps the focused entry and its open action', async ({page},info) => {
  test.setTimeout(120000);
  const driverHashes = captureInputs(sources);
  await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
  await page.goto('/');
  for(const name of ['one.txt','two.txt','three.txt'])await importRecent(page,name);
  await page.getByRole('button',{name:'Files',exact:true}).click();
  await page.getByRole('button',{name:'App files',exact:true}).click();
  const chosen = page.getByRole('button',{name:'Open two.txt',exact:true});
  await expect(chosen).toBeVisible();
  let intent = 0;
  const observe = async () => {
    const actual=await rows(page);
    return {'s.visibleRows':qset(actual.shown),'s.focusedRow':actual.focused,'s.intendedRow':intent,'s.activatedRow':actual.activated};
  };
  const trace={name:'folder-sort-keeps-focused-entry',init:{name:'init'},expect:{'s.focusedRow':0},steps:[] as any[]};
  trace.steps.push({label:'render actual folder listing',action:{name:'renderRows',args:[qset([1,2,3])]},expect:await observe()});
  await chosen.focus();
  intent=(await rows(page)).focused;
  await page.evaluate(() => (window as any).originalFolderEntry=document.activeElement);
  const before=(await rows(page)).shown;
  trace.steps.push({label:'focus existing folder entry',action:{name:'focusRow',args:[intent]},expect:await observe()});
  await page.evaluate(() => {
    const screen=document.querySelector('[data-screen]') as any;
    const key=Object.keys(screen).find(name=>name.startsWith('__reactFiber$'))!;
    let fiber=screen[key];
    while(fiber && !(fiber.stateNode && typeof fiber.stateNode.vget==='function'))fiber=fiber.return;
    fiber.stateNode.renderVals().files.fd.toggleSort();
  });
  await expect.poll(async()=>(await rows(page)).shown).not.toEqual(before);
  await expect(chosen).toBeFocused();
  expect(await chosen.evaluate(element=>element===(window as any).originalFolderEntry)).toBe(true);
  trace.steps.push({label:'source sort callback reorders entries',action:{name:'renderRows',args:[qset([1,2,3])]},expect:await observe()});
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-alpha-subview="files-preview"]')).toContainText('two.txt payload');
  intent=0;
  trace.steps.push({label:'open retained folder entry',action:{name:'activateRow'},expect:await observe()});
  const receipt=await checkTraces({model:'FilesTree',id:'FilesFolderFocus',sources,driverHashes,traces:[trace],
    scope:'bounded-orchestration',assumptions:[
      'Real browser file import/listing, renderer, sort callback and entry-open handler execute against three synthetic text files.',
      'Only row identity and activation target are observed. Listing authority and mutation outcomes remain separate model obligations.',
    ]});
  expect(receipt.passed).toBe(true);
  await info.attach('quint-refinement-receipt',{body:JSON.stringify(receipt),contentType:'application/json'});
});
