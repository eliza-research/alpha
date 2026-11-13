import {expect, test, type Locator, type Page} from '@playwright/test';

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind:'offline'})));
  await page.goto('/', {waitUntil:'domcontentloaded'});
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
});

const filesBrowse = (page:Page) => page.locator('[data-alpha-subview="files-list"]');
const filesFolder = (page:Page) => page.locator('[data-alpha-subview="files-folder"]');
const status = (scope:Locator, text:string) => scope.getByRole('status').filter({hasText:text});
const permissionReason = 'Files shows your files and folders after you allow access.';
const openFiles = (page:Page) => page.getByRole('button', {name:'Files', exact:true}).click();

test('Files explains held reads and requests storage access only after Allow', async ({page}) => {
  await page.evaluate(async () => {
    const {BrowserFiles} = await import('/src/browser/files.ts');
    const readState = BrowserFiles.prototype.storageState;
    const readList = BrowserFiles.prototype.storageList;
    const state = Promise.withResolvers<void>();
    const list = Promise.withResolvers<void>();
    const fixture = {stateReads:0, listReads:0, requests:0, releaseState:state.resolve, releaseList:list.resolve};
    Object.assign(window, {filesReadStatus:fixture});
    BrowserFiles.prototype.storageState = async function () {
      fixture.stateReads++;
      await state.promise;
      return fixture.requests ? readState.call(this) : {status:'ready', access:'denied', volumes:[]};
    };
    BrowserFiles.prototype.storageRequestAccess = async function () {
      fixture.requests++;
      return {status:'ready', access:'granted'};
    };
    BrowserFiles.prototype.storageList = async function (input) {
      fixture.listReads++;
      await list.promise;
      return readList.call(this, input);
    };
  });
  await openFiles(page);
  const browse = filesBrowse(page);
  await expect.poll(() => page.evaluate(() => (window as any).filesReadStatus.stateReads)).toBeGreaterThan(0);
  await expect(status(browse, 'Loading…')).toBeVisible();
  await expect(browse.getByRole('button', {name:'Allow', exact:true})).toHaveCount(0);
  await page.evaluate(() => (window as any).filesReadStatus.releaseState());
  await expect(browse.getByRole('alert')).toContainText(permissionReason);
  await expect(status(browse, 'Loading…')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).filesReadStatus.requests)).toBe(0);
  await browse.getByRole('button', {name:'Allow', exact:true}).click();
  await browse.getByRole('button', {name:'Internal storage', exact:true}).click();
  const folder = filesFolder(page);
  await expect.poll(() => page.evaluate(() => (window as any).filesReadStatus.listReads)).toBeGreaterThan(0);
  await expect(status(folder, 'Loading…')).toBeVisible();
  await expect(status(folder, 'No files to show')).toHaveCount(0);
  await page.evaluate(() => (window as any).filesReadStatus.releaseList());
  await expect(status(folder, 'No files to show')).toBeVisible();
  await expect(status(folder, 'Loading…')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).filesReadStatus.requests)).toBe(1);
});

test('the active folder distinguishes lost storage from denied access and recovers explicitly', async ({page}) => {
  await page.evaluate(async () => {
    const {BrowserFiles} = await import('/src/browser/files.ts');
    const {registerPlugin} = await import('/src/platform-plugins.ts');
    await registerPlugin<any>('AlphaFiles').importFile(new File(['Reviewed content'], 'retained.txt', {type:'text/plain'}));
    const readState = BrowserFiles.prototype.storageState;
    const readList = BrowserFiles.prototype.storageList;
    const fixture = {unavailable:false, denyList:false, requests:0};
    Object.assign(window, {filesReadStatus:fixture});
    BrowserFiles.prototype.storageState = async function () {
      if (fixture.unavailable) throw Error('Storage state unavailable');
      return readState.call(this);
    };
    BrowserFiles.prototype.storageList = async function (input) {
      return fixture.denyList ? {status:'denied', access:'denied', legacy:true} : readList.call(this, input);
    };
    BrowserFiles.prototype.storageRequestAccess = async function () {
      fixture.requests++;
      fixture.denyList = false;
      return {status:'ready', access:'granted'};
    };
  });
  await openFiles(page);
  await filesBrowse(page).getByRole('button', {name:'Internal storage', exact:true}).click();
  const folder = filesFolder(page);
  const row = folder.getByRole('button', {name:'Open retained.txt', exact:true});
  await expect(row).toBeVisible();
  await page.evaluate(() => {
    (window as any).filesReadStatus.unavailable = true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(folder.getByRole('alert')).toHaveText('Storage unavailable');
  await expect(folder.getByRole('button', {name:'Allow', exact:true})).toHaveCount(0);
  await expect(status(folder, 'No files to show')).toHaveCount(0);
  await expect(row).toHaveCount(0);
  await page.evaluate(() => {
    Object.assign((window as any).filesReadStatus, {unavailable:false, denyList:true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(folder.getByRole('alert')).toContainText('Allow storage access');
  await expect(folder.getByRole('alert')).toContainText(permissionReason);
  await expect(status(folder, 'No files to show')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).filesReadStatus.requests)).toBe(0);
  await folder.getByRole('button', {name:'Allow', exact:true}).click();
  await expect(row).toBeVisible();
  await expect(folder.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).filesReadStatus.requests)).toBe(1);
});

test('Files explains partial and failed reads while keeping the returned rows', async ({page}) => {
  await page.evaluate(async () => {
    const {BrowserFiles} = await import('/src/browser/files.ts');
    const {registerPlugin} = await import('/src/platform-plugins.ts');
    await registerPlugin<any>('AlphaFiles').importFile(new File(['A listed file'], 'listed.txt', {type:'text/plain'}));
    const readList = BrowserFiles.prototype.storageList;
    const fixture = {result:'partial'};
    Object.assign(window, {filesReadStatus:fixture});
    BrowserFiles.prototype.storageList = async function (input) {
      if (fixture.result === 'failed') return {status:'unavailable'};
      const result = await readList.call(this, input);
      return {...result, truncated:fixture.result === 'partial'};
    };
  });
  await openFiles(page);
  await filesBrowse(page).getByRole('button', {name:'Internal storage', exact:true}).click();
  const folder = filesFolder(page);
  const row = folder.getByRole('button', {name:'Open listed.txt', exact:true});
  await expect(status(folder, 'This listing is incomplete.')).toBeVisible();
  await expect(row).toBeVisible();
  await expect(status(folder, 'No files to show')).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).filesReadStatus.result = 'failed';
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(status(folder, 'Files could not be read.')).toBeVisible();
  await expect(status(folder, 'This listing is incomplete.')).toHaveCount(0);
  await expect(status(folder, 'No files to show')).toHaveCount(0);
  await expect(row).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).filesReadStatus.result = 'ready';
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(row).toBeVisible();
  await expect(status(folder, 'Files could not be read.')).toHaveCount(0);
});
