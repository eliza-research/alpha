import {test, expect, type Page} from '@playwright/test';
import {captureInputs, checkTraces} from '../../specs/quint/refinement/check-traces.mjs';

const sources = [
  'apps/app/src/prototype/dc-lite.js',
  'apps/app/src/prototype/settings-adapter.ts',
  'apps/app/src/prototype/template.html',
  'apps/app/src/prototype/model.js',
  'apps/app/src/browser/device.ts',
  'test/browser/settings-focus-identity.spec.ts',
];

async function observe(page: Page) {
  return page.evaluate(() => {
    const identity = (element: Element | null) => {
      const label = element?.getAttribute('aria-label');
      return label === 'About' ? 'about' : label === 'Finish setup' ? 'setup' : '';
    };
    const top = document.querySelector('[data-settings-page="Settings"]');
    const rows = [...(top?.querySelectorAll('button') || [])].map(identity).filter(Boolean);
    const focused = identity(document.activeElement);
    return {
      's.settingsRows': rows,
      's.focusedSetting': focused,
      's.intendedSetting': focused ? (window as any).settingsFocusIntent || '' : '',
      's.activatedSetting': [...document.querySelectorAll('h1')].some(title => title.textContent === 'About') ? 'about' : '',
    };
  });
}

test('late Settings permissions preserve the focused About action and refine the row identity model', async ({page}, info) => {
  test.setTimeout(120000);
  const driverHashes = captureInputs(sources);
  await page.addInitScript(() => {
    localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind:'offline'}));
    const pending: Array<() => void> = [];
    let released = false;
    (window as any).releaseSettingsPermissionRead = () => {
      released = true;
      pending.splice(0).forEach(resolve => resolve());
    };
    Object.defineProperty(navigator.permissions, 'query', {configurable:true, value:async () => {
      if (!released) await new Promise<void>(resolve => pending.push(resolve));
      return {state:'prompt', addEventListener(){}, removeEventListener(){}};
    }});
  });
  await page.goto('/?mode=dev');
  await expect(page.getByRole('button', {name:'Settings',exact:true})).toBeVisible();
  const trace = {name:'late-permission-group-preserves-focus', init:{name:'init'},
    expect:await observe(page), steps:[] as any[]};
  await page.getByRole('button', {name:'Settings',exact:true}).click();
  const about = page.getByRole('button', {name:'About',exact:true});
  await expect(about).toBeVisible();
  await expect(page.getByRole('button', {name:'Finish setup',exact:true})).toHaveCount(0);
  trace.steps.push({label:'open actual Settings', action:{name:'open',args:['settings']}, expect:await observe(page)});
  await about.focus();
  await expect(about).toBeFocused();
  await page.evaluate(() => {
    (window as any).originalSettingsAbout = document.activeElement;
    (window as any).settingsFocusIntent = document.activeElement?.getAttribute('aria-label') === 'About' ? 'about' : '';
  });
  trace.steps.push({label:'focus actual About row', action:{name:'focusSetting',args:['about']}, expect:await observe(page)});
  await page.evaluate(() => (window as any).releaseSettingsPermissionRead());
  await expect(page.getByRole('button', {name:'Finish setup',exact:true})).toBeVisible();
  await expect(about).toBeFocused();
  expect(await about.evaluate(element => element === (window as any).originalSettingsAbout)).toBe(true);
  trace.steps.push({label:'late permission snapshot inserts Privacy group',
    action:{name:'settingsRowsChanged',args:[['setup','about']]}, expect:await observe(page)});
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', {name:'About',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog', {name:'Notifications',exact:true})).toHaveCount(0);
  trace.steps.push({label:'Enter activates the originally focused action', action:{name:'activateSetting'}, expect:await observe(page)});
  const receipt = await checkTraces({model:'ShellNavigation', id:'ShellSettingsFocus',
    sources, driverHashes, traces:[trace], scope:'bounded-orchestration', assumptions:[
      'Real Chromium renderer and Settings adapter execute with delayed browser permission-query promises.',
      'About and Finish setup represent semantic row identities. This trace covers one late group insertion and keyboard activation.',
      'Other dynamic lists, removal, and native assistive technology are separate obligations.',
    ]});
  expect(receipt.passed).toBe(true);
  await info.attach('quint-refinement-receipt', {body:JSON.stringify(receipt),contentType:'application/json'});
});
