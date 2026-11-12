import {chooseMailAction} from '../test/browser/helpers/mail-actions.ts';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';

// Rendered autosave and discard flow. Provider and encrypted-store boundaries are synthetic.
const url = process.env.ALPHA_INBOX_TEST_URL || 'http://127.0.0.1:5197';
if (new URL(url).hostname !== '127.0.0.1') throw Error('Local Vite required');
const require = createRequire(path.join(process.env.ALPHA_BROWSER_MODULES, '__inbox.cjs'));
const {chromium} = require('playwright');
const {expect} = require('@playwright/test');
const slots = new Map();
const browser = await chromium.launch({headless:true});
try {
 const page = await browser.newPage({viewport:{width:412,height:915},reducedMotion:'reduce'});
 page.setDefaultTimeout(10000);
 await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.exposeFunction('fixtureRead', slot => slots.get(slot) || null);
 await page.exposeFunction('fixtureCAS', (slot, expected, value) => {
  if (JSON.stringify(slots.get(slot) || null) !== JSON.stringify(expected)) return {status:'conflict'};
  if (value === null) slots.delete(slot); else slots.set(slot,value);
  return {status:'saved'};
 });
 async function setup(account = 'a') {
  await page.goto(url);
  await page.evaluate(async account => {
   const {connectionController} = await import('/src/runtime/connection-ui.tsx');
   const {inboxLocalStore} = await import('/src/runtime/inbox-local-store.ts');
   inboxLocalStore.read = slot => window.fixtureRead(slot);
   inboxLocalStore.compareExchange = (...args) => window.fixtureCAS(...args);
   const fixture = window.inboxFixture = {account,calls:[]};
   const mail = {id:'fixture-message',threadId:'fixture-thread',from:'Synthetic sender',fromEmail:'sender@example.invalid',to:['owner@example.invalid'],subject:'Reply fixture',snippet:'Synthetic',receivedAt:'2026-09-30T00:00:00Z',unread:false};
   const client = {
    gmailAccounts: async () => {fixture.calls.push('accounts');return [{connectionId:account,label:'Fixture '+account,connected:true,grantedCapabilities:['google.gmail.triage']}];},
    gmailSearch: async () => {fixture.calls.push('search');return {messages:[mail],syncedAt:'fixture-revision'};},
    gmailRead: async () => {fixture.calls.push('read');return {message:mail,bodyText:'Synthetic message body'};},
   };
   connectionController.getCloudClient = () => ({client,sessionId:'fixture-cloud-'+account});
   const snapshot = {...connectionController.getSnapshot(),cloudAccount:{environment:'production',userId:'fixture-owner',sessionId:'fixture-cloud-'+account,credentialId:'fixture-only'}};
   connectionController.getSnapshot = () => snapshot;
  },account);
  await page.getByRole('button',{name:'Inbox',exact:true}).and(page.locator('[data-mobile-shell-tile]')).click();
  await expect(page.getByRole('button',{name:'Compose',exact:true})).toBeEnabled();
 }
 async function retained(account = 'a') {
  return page.evaluate(async account => {
   const owner = JSON.stringify(['production','fixture-owner','',account]);
   const binding = JSON.stringify(['inbox-unsaved','app',owner]);
   const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(binding))),value => value.toString(16).padStart(2,'0')).join('');
   const {BrowserJsonDomainDocument} = await import('/src/browser/json-domain-document.ts');
   const row = await new BrowserJsonDomainDocument('alpha.browser.inbox-drafts:v1:unsaved:'+hash).readJson();
   return row?.text ? JSON.parse(row.text) : null;
  },account);
 }
 async function reopen(subject) {
  await page.getByRole('button',{name:'Other mail folders',exact:true}).click();
  await page.getByRole('menuitemradio',{name:'Drafts',exact:true}).click();
  await page.getByRole('button',{name:new RegExp(subject)}).first().click();
 }
 const body = () => page.getByRole('textbox',{name:'Message',exact:true});
 const close = () => page.getByRole('button',{name:'Back from draft',exact:true}).click();
 const confirm = () => page.getByRole('dialog',{name:'Discard this draft?',exact:true});
 await setup();
 await page.getByRole('button',{name:'Compose',exact:true}).click();
 await page.getByRole('textbox',{name:'To',exact:true}).fill('literal@example.invalid');
 await page.getByRole('textbox',{name:'To',exact:true}).press('Enter');
 await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Private fixture draft');
 await body().fill('Exact local body\nsecond line');
 await expect.poll(async () => (await retained())?.draft.body).toBe('Exact local body\nsecond line');
 await expect(page.getByRole('button',{name:'Save draft locally',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Discard local draft',exact:true})).toHaveCount(0);
 assert.equal(await page.getByRole('button',{name:'Send email',exact:true}).isDisabled(),true);
 await close();
 await confirm().getByRole('button',{name:'No',exact:true}).click();
 await expect(body()).toHaveValue('Exact local body\nsecond line');
 await setup();
 await reopen('Private fixture draft');
 await expect(body()).toHaveValue('Exact local body\nsecond line');
 assert.deepEqual((await retained()).draft.to,['literal@example.invalid']);
 await setup('b');
 await page.getByRole('button',{name:'Compose',exact:true}).click();
 await expect(body()).toHaveValue('');
 await body().fill('Owner B retained');
 await expect.poll(async () => (await retained('b'))?.draft.body).toBe('Owner B retained');
 await setup();
 await reopen('Private fixture draft');
 await close();
 await confirm().getByRole('button',{name:'Yes',exact:true}).click();
 await expect(body()).toHaveCount(0);
 await expect.poll(() => retained()).toBe(null);
 assert.equal((await retained('b')).draft.body,'Owner B retained');
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await page.getByRole('button',{name:'Synthetic sender, Reply fixture',exact:true}).click();
 await chooseMailAction(page,'Reply');
 await body().fill('Reply draft only');
 await expect.poll(async () => (await retained())?.draft.body).toBe('Reply draft only');
 assert.deepEqual((await retained()).draft.reply,{messageId:'fixture-message',threadId:'fixture-thread'});
 await setup();
 await page.getByRole('button',{name:'Compose',exact:true}).click();
 await expect(body()).toHaveValue('');
 await body().fill('Separate second draft');
 await expect.poll(async () => (await retained())?.draft.body).toBe('Separate second draft');
 assert.ok([...slots.values()].some(value => JSON.stringify(value).includes('Reply draft only')),'starting another email retains the previous one');
 assert.ok((await page.evaluate(() => window.inboxFixture.calls)).every(value => ['accounts','read','search'].includes(value)));
 console.log('PASS rendered autosave, reload, exact body/recipient retention, account isolation, discard No/Yes, reply identity and separate draft creation. No provider writes.');
} finally {
 await browser.close();
}
