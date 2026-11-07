// AP-05 continuity on the flag-off renderer with the resident agent: the composer draft lives in
// the device's secure slot (the shared durable draft controller over a compare-and-exchange slot)
// and survives HOME, Back, a keyboard-sized resize and a restart; a reply in flight survives Back
// from full to sheet and HOME on Home; a message in flight when the app stops is offered for review
// after the restart, never restored as a draft; the transcript keeps its reading position through
// the same steps. Nothing is ever sent twice.
//
// Evidence boundary: source/test evidence for the flag-off renderer only. The Capacitor bridge is
// the stub in flag-off-android.ts plus resident-stub.ts; viewport changes stand in for the soft
// keyboard. This is not the native Agent plugin, a real IME, Android Back/HOME or a device.
import { test, expect, type Page } from '@playwright/test';
import { flagOffAndroid, harness, button, fenceNetwork, expectNoDevelopmentSurface, residentHome } from './flag-off-android';
import { residentStub, stub, setStub } from './resident-stub';

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'production', 'Production bundle only'); });

const owner = { token: 'synthetic-cloud-key', userId: '9f1dc45a-4011-4e44-947a-30d999d24fa5', email: 'owner@example.invalid', balance: 5 };
const composer = (page: Page) => page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();
const conversation = (page: Page) => page.locator('[data-alpha-layer="conversation"]');
const UNKNOWN = 'Sorry, I couldn’t finish that reply.';
const home = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
const back = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('alpha-back', { cancelable: true })));

async function connected(page: Page) {
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page);
  await residentStub(page, { accounts: [owner] });
  await residentHome(page);
  return foreign;
}
/** Draft texts held in the device's secure draft slots (the installed `assistant-draft:v1:` names). */
const savedDrafts = (page: Page) => harness(page, f => Object.entries(f.slots as Record<string, string>).filter(([slot]) => slot.startsWith('assistant-draft:v1:')).map(([, raw]) => JSON.parse(raw).text as string));
/** The same slots with the mark a send in flight leaves on its saved text. */
const savedRows = (page: Page) => harness(page, f => Object.entries(f.slots as Record<string, string>).filter(([slot]) => slot.startsWith('assistant-draft:v1:')).map(([, raw]) => { const row = JSON.parse(raw); return { text: row.text as string, sending: row.sending === true }; }));
/** The slots that still hold text: a slot cleared after its message was sent keeps an empty row. */
const keptRows = async (page: Page) => (await savedRows(page)).filter(row => row.text);
const UNSETTLED = 'This message may already have been sent. Check the conversation before sending it again.';
const REVIEW_UNSETTLED = 'Review the message that may already have been sent before sending another.';
const draftStatus = (page: Page) => page.getByRole('status', { name: 'Assistant draft status', exact: true });
/** Let the panel's height and transform animations finish, then two frames for layout and scroll. */
const settle = async (page: Page) => {
  await conversation(page).evaluate(element => Promise.all(element.getAnimations({ subtree: true }).filter(animation => animation.timeline === document.timeline && Number.isFinite(animation.effect?.getTiming().iterations)).map(animation => animation.finished.catch(() => {}))));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
};
async function noResend(page: Page, foreign: string[], streams: number) {
  await page.waitForTimeout(1_000);
  expect(await harness(page, f => f.streams)).toBe(streams);
  expect(await stub(page, s => s.recoveries)).toEqual([]);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  await expectNoDevelopmentSurface(page);
  expect(foreign).toEqual([]);
}

test('the device draft survives HOME, Back, a keyboard resize and rotation with its selection, and a restart, and nothing is sent', async ({ page }) => {
  test.setTimeout(150_000);
  const foreign = await connected(page);
  const text = 'Unsent words that must outlive every layout change';
  await composer(page).fill(text);
  await expect.poll(() => savedDrafts(page), { timeout: 15_000 }).toEqual([text]);

  await home(page);
  await expect(composer(page)).toHaveValue(text);
  await back(page);
  await expect(composer(page)).toHaveValue(text);
  await button(page, 'Open conversation').click();
  await expect(composer(page)).toHaveValue(text);
  await button(page, 'Expand chat').click();
  await expect(button(page, 'Shrink chat')).toBeVisible();
  await expect(composer(page)).toHaveValue(text);

  // The soft keyboard shortens the window while the composer has focus, and a rotation with the
  // keyboard still up swaps the sides: the same field keeps its text, focus and selection and stays
  // fully on screen; turning back and closing the keyboard changes nothing.
  const field = composer(page), original = await field.elementHandle();
  await field.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(6, 11); });
  for (const viewport of [{ width: 412, height: 520 }, { width: 915, height: 300 }, { width: 412, height: 520 }, { width: 412, height: 915 }]) {
    await page.setViewportSize(viewport);
    await expect(field).toHaveValue(text);
    await expect(field).toBeInViewport({ ratio: 1 });
    await expect(field).toBeFocused();
    expect(await field.evaluate((element, previous) => element === previous, original)).toBe(true);
    expect(await field.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([6, 11]);
  }
  // Back steps full to sheet to rest and keeps the words.
  await back(page);
  await expect(button(page, 'Expand chat')).toBeVisible();
  await expect(composer(page)).toHaveValue(text);
  await back(page);
  await expect(composer(page)).toHaveValue(text);
  expect(await savedDrafts(page)).toEqual([text]);

  // A restart reads the same device slot back into the composer.
  await residentHome(page);
  await expect(composer(page)).toHaveValue(text, { timeout: 30_000 });
  expect(await savedDrafts(page)).toEqual([text]);
  expect(await harness(page, f => f.posts)).toEqual([]);
  await noResend(page, foreign, 0);
});

// Collapsing the chat is not a Stop: Back from full to sheet, and HOME while Home is the current
// app, keep the resident reply streaming, and it is shown once. Neither is a layout change: a
// rotation to landscape and a keyboard-sized window while the reply streams keep it too.
for (const step of ['Back from full to sheet', 'HOME on Home', 'a rotation and the keyboard'] as const) {
  test(`${step} during a resident reply keeps it: the reply appears once and nothing is resent`, async ({ page }) => {
    test.setTimeout(120_000);
    const foreign = await connected(page);
    await setStub(page, { stream: 'hold' });
    const asked = `Keep replying after ${step}`;
    await composer(page).fill(asked);
    await composer(page).press('Enter');
    await expect.poll(() => stub(page, s => typeof s.release), { timeout: 15_000 }).toBe('function');
    await expect(button(page, 'Stop reply')).toBeVisible();
    if (step === 'Back from full to sheet') {
      await button(page, 'Expand chat').click();
      await expect(button(page, 'Shrink chat')).toBeVisible();
      await back(page);
      await expect(button(page, 'Expand chat')).toBeVisible();
    } else if (step === 'HOME on Home') {
      await home(page);
      await expect(conversation(page)).toHaveAttribute('aria-hidden', 'true');
    } else {
      for (const viewport of [{ width: 915, height: 412 }, { width: 412, height: 520 }, { width: 412, height: 915 }]) {
        await page.setViewportSize(viewport);
        await expect(button(page, 'Stop reply')).toBeVisible();
      }
    }
    await stub(page, s => s.release());
    await expect(conversation(page).getByText('Held reply 1', { exact: true })).toHaveCount(1);
    await expect(conversation(page).getByText(asked, { exact: true })).toHaveCount(1);
    await expect(button(page, 'Stop reply')).toHaveCount(0);
    await expect(page.getByText(UNKNOWN, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Check saved conversation/ })).toHaveCount(0);
    // The sent text's device copy was cleared once the turn was dispatched.
    await expect.poll(() => savedDrafts(page)).toEqual(['']);
    // One post, carrying this message after its current-turn screen observation.
    const posts = await harness(page, f => f.posts as string[]);
    expect(posts).toHaveLength(1);
    // A product build sends the authored text; the screen observation travels only in metadata.
    expect(posts[0]).toBe(asked);
    await noResend(page, foreign, 1);
  });
}

// A restart while a sent message is in flight (the process dies before the reply): the device copy
// of the sent text is marked as sending, so the next start never puts it back in the composer as
// a draft. It is offered for review, sending waits for that review, and nothing is posted again.
// The conversation already exists, so the restart reopens the same draft slot (a new chat's
// first message is covered after these two tests).
async function restartDuringSend(page: Page, asked: string) {
  const foreign = await connected(page);
  await composer(page).fill('Start the conversation');
  await composer(page).press('Enter');
  await expect(conversation(page).getByText('Resident reply 1', { exact: true })).toHaveCount(1, { timeout: 30_000 });
  await expect(button(page, 'Stop reply')).toHaveCount(0);
  await setStub(page, { stream: 'hold' });
  await composer(page).fill(asked);
  await composer(page).press('Enter');
  await expect.poll(() => stub(page, s => typeof s.release), { timeout: 15_000 }).toBe('function');
  await expect.poll(() => keptRows(page)).toEqual([{ text: asked, sending: true }]);
  expect(await harness(page, f => f.posts)).toHaveLength(2);
  await setStub(page, { stream: null });
  await residentHome(page);
  await expect(draftStatus(page)).toHaveText(UNSETTLED, { timeout: 30_000 });
  await expect(composer(page)).toHaveValue('');
  await expect(page.getByText(`Saved copy: ${asked}`, { exact: true })).toBeVisible();
  await expect(button(page, 'Restore saved draft')).toBeInViewport({ratio:1});
  return foreign;
}

test('a restart during a send offers the message for review, never as a draft; restoring it makes it a draft again', async ({ page }) => {
  test.setTimeout(180_000);
  const asked = 'Sent just before the app stopped';
  const foreign = await restartDuringSend(page, asked);
  // The conversation the agent kept shows the message once; the phone posted nothing after the restart.
  await button(page, 'Open conversation').click();
  await expect(conversation(page).getByText(asked, { exact: true })).toHaveCount(1, { timeout: 30_000 });
  await composer(page).fill('A different question');
  await composer(page).press('Enter');
  await expect(page.getByText(REVIEW_UNSETTLED, { exact: true })).toBeVisible();
  expect(await harness(page, f => f.posts)).toEqual([]);
  expect(await keptRows(page)).toEqual([{ text: asked, sending: true }]);

  // Restoring puts the saved words back to edit; the copy is an ordinary draft from then on.
  await button(page, 'Restore saved draft').click();
  await expect(composer(page)).toHaveValue(asked);
  await expect.poll(() => keptRows(page)).toEqual([{ text: asked, sending: false }]);
  await residentHome(page);
  await expect(composer(page)).toHaveValue(asked, { timeout: 30_000 });
  await expect(draftStatus(page)).toHaveCount(0);
  expect(await harness(page, f => f.posts)).toEqual([]);
  await noResend(page, foreign, 0);
});

test('replacing the reviewed message after a restart clears only its copy, and the next message is sent once', async ({ page }) => {
  test.setTimeout(180_000);
  const foreign = await restartDuringSend(page, 'Already answered before the restart');
  await button(page, 'Replace saved draft with this text').click();
  await expect(draftStatus(page)).toHaveCount(0);
  await expect.poll(() => keptRows(page)).toEqual([]);
  const next = 'The next question';
  await composer(page).fill(next);
  await composer(page).press('Enter');
  // The restored conversation already shows the first reply; wait for this message's post and turn.
  await expect.poll(() => harness(page, f => (f.posts as string[]).length), { timeout: 30_000 }).toBe(1);
  await expect(conversation(page).getByText(next, { exact: true })).toHaveCount(1, { timeout: 30_000 });
  await expect(button(page, 'Stop reply')).toHaveCount(0, { timeout: 30_000 });
  const posts = await harness(page, f => f.posts as string[]);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toBe(next);
  await expect.poll(() => keptRows(page)).toEqual([]);
  await noResend(page, foreign, 1);
});

// A new chat's first message, with no warmup send: its text is held in the "no conversation yet"
// slot while the send creates and selects the conversation. The restart opens that conversation,
// and the held message is offered for review there, not only when a later new chat opens.
// Sending waits for the review, and nothing is posted again.
test('a restart during a new chat\'s first message offers it for review on the conversation it created', async ({ page }) => {
  test.setTimeout(180_000);
  const foreign = await connected(page);
  const asked = 'First message just before the app stopped';
  await setStub(page, { stream: 'hold' });
  await composer(page).fill(asked);
  await composer(page).press('Enter');
  await expect.poll(() => stub(page, s => typeof s.release), { timeout: 15_000 }).toBe('function');
  await expect.poll(() => keptRows(page)).toEqual([{ text: asked, sending: true }]);
  expect(await harness(page, f => f.posts)).toHaveLength(1);
  await setStub(page, { stream: null });
  await residentHome(page);
  await expect(draftStatus(page)).toHaveText(UNSETTLED, { timeout: 30_000 });
  await expect(composer(page)).toHaveValue('');
  await expect(page.getByText(`Saved copy: ${asked}`, { exact: true })).toBeVisible();
  await expect(button(page, 'Restore saved draft')).toBeInViewport({ratio:1});
  await composer(page).fill('A different question');
  await composer(page).press('Enter');
  await expect(page.getByText(REVIEW_UNSETTLED, { exact: true })).toBeVisible();
  expect(await harness(page, f => f.posts)).toEqual([]);
  await composer(page).fill('');
  await button(page, 'Replace saved draft with this text').click();
  await expect(draftStatus(page)).toHaveCount(0);
  await expect.poll(() => keptRows(page)).toEqual([]);
  expect(await harness(page, f => f.posts)).toEqual([]);
  await noResend(page, foreign, 0);
});

test('the transcript keeps its reading position through a keyboard resize, Back from full and HOME, and follows the newest message at the bottom', async ({ page }) => {
  test.setTimeout(180_000);
  const foreign = await connected(page);
  await composer(page).fill('Start a long conversation');
  await composer(page).press('Enter');
  await expect(conversation(page).getByText('Resident reply 1', { exact: true })).toHaveCount(1);
  // The resident agent's saved conversation holds older history; a restart restores all of it.
  await page.evaluate(() => {
    const agent = JSON.parse(sessionStorage.getItem('resident-stub-agent') || 'null'), id = agent.conversations[0].id;
    const older = Array.from({ length: 60 }, (_, index) => ({ id: crypto.randomUUID(), role: index % 2 ? 'assistant' : 'user', text: `Historical ${index}: synthetic text for scroll continuity. More text stays on this message.`, timestamp: 1_000 + index }));
    agent.history[id] = [...older, ...agent.history[id]];
    sessionStorage.setItem('resident-stub-agent', JSON.stringify(agent));
  });
  await residentHome(page);
  await button(page, 'Open conversation').click();
  const transcript = page.locator('[data-alpha-transcript]');
  await expect(transcript.locator('[data-alpha-message-id]')).toHaveCount(62, { timeout: 30_000 });
  await button(page, 'Expand chat').click();
  await expect(button(page, 'Shrink chat')).toBeVisible();
  await settle(page);

  const offset = (id: string) => transcript.evaluate((element, id) => element.querySelector(`[data-alpha-message-id="${id}"]`)!.getBoundingClientRect().top - element.getBoundingClientRect().top, id);
  const fromBottom = () => transcript.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop);
  const steps: Array<[string, () => Promise<unknown>]> = [
    ['keyboard resize', async () => { await page.setViewportSize({ width: 412, height: 520 }); await settle(page); }],
    ['keyboard closed', async () => { await page.setViewportSize({ width: 412, height: 915 }); await settle(page); }],
    ['Back from full', async () => { await back(page); await expect(button(page, 'Expand chat')).toBeVisible(); await settle(page); }],
    ['HOME then reopen', async () => { await home(page); await expect(conversation(page)).toHaveAttribute('aria-hidden', 'true'); await settle(page); await button(page, 'Open conversation').click(); await expect(conversation(page)).not.toHaveAttribute('aria-hidden', 'true'); await settle(page); }],
  ];
  // Reading older history: the anchored message stays where it was after every step.
  const before = await transcript.evaluate(element => {
    element.scrollTop = element.scrollHeight / 3;
    const top = element.getBoundingClientRect().top;
    const anchor = Array.from(element.querySelectorAll('[data-alpha-message-id]')).find(row => row.getBoundingClientRect().bottom > top)!;
    return { id: anchor.getAttribute('data-alpha-message-id')!, y: anchor.getBoundingClientRect().top - top };
  });
  for (const [name, step] of steps) { await step(); expect(Math.abs(await offset(before.id) - before.y), name).toBeLessThan(2); }
  // At the bottom: every step keeps following the newest message.
  await button(page, 'Expand chat').click();
  await settle(page);
  await transcript.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await settle(page);
  for (const [name, step] of steps) { await step(); expect(await fromBottom(), name).toBeLessThan(2); }
  // The restart restored history by reading it; no turn was streamed again.
  await noResend(page, foreign, 0);
});
