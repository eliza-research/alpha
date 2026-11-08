import {test, expect, type Page} from '@playwright/test';
import {captureInputs, checkTraces, qset} from '../../specs/quint/refinement/check-traces.mjs';

const sources = ['apps/app/src/prototype/browser-adapter.ts', 'apps/app/src/prototype/model.js',
  'apps/app/src/prototype/template.html', 'apps/app/src/prototype/dc-lite.js',
  'apps/app/src/browser/browsing-session.ts', 'test/browser/browser-list-focus.spec.ts'];

async function browserState(page: Page) {
  return page.evaluate(() => {
    const screen = document.querySelector('[data-screen]') as any;
    const key = Object.keys(screen).find(name => name.startsWith('__reactFiber$'))!;
    let fiber = screen[key];
    while (fiber && !(fiber.stateNode && typeof fiber.stateNode.vget === 'function')) fiber = fiber.return;
    const state = fiber.stateNode.vget('browser');
    const buttons = [...document.querySelectorAll('button')].filter(button => button.getAttribute('aria-label')?.startsWith('Switch to '));
    const focused = buttons.indexOf(document.activeElement as HTMLButtonElement);
    return {tabs:state.tabs.map((tab: any) => ({id:tab.id,private:!!tab.priv})),
      current:state.cur,open:!!state.tabsOpen,focused:focused >= 0 ? state.tabs[focused].id : null};
  });
}

test('closing an earlier tab preserves the focused tab and its activation identity', async ({page}, info) => {
  test.setTimeout(120000);
  const driverHashes = captureInputs(sources);
  await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind:'offline'})));
  await page.goto('/');
  await page.getByRole('button', {name:'Browser',exact:true}).click();
  const initial = await browserState(page);
  const identities = new Map([[initial.tabs[0].id,1]]);
  let intent = 0;
  const observe = async () => {
    const state = await browserState(page);
    return {'s.normal':qset(state.tabs.filter(tab => !tab.private).map(tab => identities.get(tab.id))),
      's.privateTabs':qset(state.tabs.filter(tab => tab.private).map(tab => identities.get(tab.id))),
      's.active':identities.get(state.current), 's.order':state.tabs.map(tab => identities.get(tab.id)), 's.tabsOpen':state.open,
      's.focusedTab':state.focused ? identities.get(state.focused) : 0, 's.intendedTab':intent};
  };
  const trace = {name:'close-earlier-tab-preserves-focus',init:{name:'init'},expect:await observe(),steps:[] as any[]};
  for (const [slot,action] of [[2,'normalTab'],[4,'thirdNormalTab']] as const) {
    await page.getByRole('button', {name:'Tabs',exact:true}).click();
    trace.steps.push({label:'open tab chooser',action:{name:'showTabs'},expect:await observe()});
    await page.getByRole('button', {name:'New tab',exact:true}).click();
    await page.keyboard.press('Escape');
    const state = await browserState(page);
    identities.set(state.current,slot);
    trace.steps.push({label:'create normal tab',action:{name:action},expect:await observe()});
  }
  await page.getByRole('button', {name:'Tabs',exact:true}).click();
  trace.steps.push({label:'show three tabs',action:{name:'showTabs'},expect:await observe()});
  const choices = page.getByRole('button', {name:/^Switch to /});
  await expect(choices).toHaveCount(3);
  const middle = choices.nth(1);
  await middle.focus();
  intent = 2;
  await page.evaluate(() => (window as any).originalFocusedTab = document.activeElement);
  trace.steps.push({label:'focus middle tab',action:{name:'focusTab',args:[2]},expect:await observe()});
  // Invoke the actual close handler without moving keyboard focus to its button.
  await page.getByRole('button', {name:'Close tab',exact:true}).first().evaluate(button => (button as HTMLButtonElement).click());
  await expect(choices).toHaveCount(2);
  expect(await page.evaluate(() => document.activeElement === (window as any).originalFocusedTab)).toBe(true);
  trace.steps.push({label:'close preceding tab while focus remains',action:{name:'closeTab',args:[1]},expect:await observe()});
  await page.keyboard.press('Enter');
  intent = 0;
  await expect(choices).toHaveCount(0);
  expect(identities.get((await browserState(page)).current)).toBe(2);
  trace.steps.push({label:'activate retained tab',action:{name:'activateFocusedTab'},expect:await observe()});
  const receipt = await checkTraces({model:'BrowserSession',id:'BrowserTabFocus',sources,driverHashes,traces:[trace],
    scope:'bounded-orchestration',assumptions:[
      'Actual renderer, browser adapter and tab close/pick handlers execute. The three normal tab IDs map to fixed model representatives.',
      'Keyboard focus is held on the middle tab while the actual earlier close handler runs. Provider navigation, private tabs and other list families are outside this trace.',
    ]});
  expect(receipt.passed).toBe(true);
  await info.attach('quint-refinement-receipt',{body:JSON.stringify(receipt),contentType:'application/json'});
});

test('removing an earlier bookmark preserves the focused link and its destination', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind:'offline'})));
  await page.route('https://focus.example/**', route => route.fulfill({contentType:'text/html',body:`<h1>${new URL(route.request().url()).pathname}</h1>`}));
  await page.goto('/');
  await page.evaluate(async () => {
    const {registerPlugin} = await import('/src/platform-plugins.ts');
    const browser = registerPlugin<any>('AlphaBrowser');
    for (const suffix of ['one','two','three']) await browser.setBookmark({url:`https://focus.example/${suffix}`,saved:true});
  });
  await page.reload();
  await page.getByRole('button',{name:'Browser',exact:true}).click();
  await page.getByRole('button',{name:'Menu',exact:true}).click();
  await page.getByRole('button',{name:'Bookmarks and history',exact:true}).click();
  const middle = page.getByRole('button',{name:'https://focus.example/two',exact:true});
  await middle.focus();
  await page.evaluate(() => (window as any).originalBookmark = document.activeElement);
  const earlier = await page.getByRole('button',{name:/^https:\/\/focus\.example\//}).first().getAttribute('aria-label');
  await page.getByRole('button',{name:'Remove bookmark',exact:true}).first().evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.getByRole('button',{name:earlier!,exact:true})).toHaveCount(0);
  await expect(middle).toBeFocused();
  expect(await middle.evaluate(element => element === (window as any).originalBookmark)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.frameLocator('[data-browser-surface] iframe').getByRole('heading',{name:'/two',exact:true})).toBeVisible();
});
