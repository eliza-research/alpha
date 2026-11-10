import path from 'node:path';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {playwright} from './fixtures/playwright.ts';

const {chromium} = playwright(import.meta.url);
const root = process.env.ALPHA_HOSTED_SOURCE_ROOT || process.cwd();
const html = await readFile(path.join(root, 'apps/app/public/delegation-return.html'), 'utf8');
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage({viewport: {width: 412, height: 915}});
  await page.route('https://phone.invalid/**', route => route.fulfill({contentType: 'text/html', body: html}));
  const returnPage = 'https://phone.invalid/delegation-return.html';
  const state = 'a'.repeat(43);
  const returnLink = page.locator('#return');
  const message = page.locator('#message');

  await page.goto(`${returnPage}?state=${state}&code=fixture-code`);
  assert.equal(page.url(), returnPage);
  assert.equal(await returnLink.getAttribute('href'), `alphaphone://cloud-delegation?state=${state}&code=fixture-code`);
  assert.equal(await message.textContent(), 'Your account is checked inside Alpha Phone before the connection is saved.');

  await page.goto(`${returnPage}?state=${state}&code=one&code=two`);
  assert.equal(await returnLink.isHidden(), true);
  assert.equal(await message.textContent(), 'This return link is invalid. Go back to Alpha Phone and reconnect.');

  await page.goto(`${returnPage}?state=${state}&error=access_denied&error_description=User%20denied%20authorization`);
  assert.equal(await returnLink.getAttribute('href'), `alphaphone://cloud-delegation?state=${state}&error=access_denied`);
  assert.equal(await message.textContent(), 'Authorization was cancelled. Continue to return to Alpha Phone.');

  await page.reload();
  assert.equal(await returnLink.isHidden(), true);
  assert.equal(await message.textContent(), 'This page was reopened. Go back to Alpha Phone to continue or restart authorization.');
  console.log('PASS HTTPS return strips query, preserves state, rejects duplicate codes and supports cancellation, and says when the page was reopened. Android intent handling remains a separate device check.');
} finally {
  await browser.close();
}
