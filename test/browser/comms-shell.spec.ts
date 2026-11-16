import {test, expect, type Page} from '@playwright/test';

// AP-16 shell (docs/agentic-comms.md): the one bottom bar, the stage above the sheet, the live strip,
// stage navigation and the faint suggestion. Phase A has no product comms view yet, so each test
// registers a test-only `bar` on reference views (Notes, Calendar) of the `?fixture=1` development
// build (ELIZA_DEV_ALLOW_TEST_MOCKS=1). It proves the shell mechanics in a browser, nothing about
// Phone, Messages or Contacts on a device.

type BarConfig = {kind?: string; field?: string; value?: string; suggestion?: string | null; end?: boolean; app?: string; emergency?: boolean};

/** Registers a recording test bar on `view`, configured live through window.__bar[view]. */
async function registerBar(page: Page, view: string, config: BarConfig = {}) {
	await page.evaluate(async ({view, config}) => {
		const {VIEWS} = await import('/src/prototype/model.js');
		const w = window as any;
		w.__calls ||= [];
		w.__bar ||= {};
		w.__bar[view] = {kind: 'thread', field: 'person', value: '', suggestion: null, end: false, app: 'Messages', emergency: false, ...config};
		const record = (name: string) => (...args: unknown[]) => { w.__calls.push([view, name, ...args]); };
		VIEWS[view].bar = (_state: unknown, api: any) => {
			const c = w.__bar[view];
			return {
				target: {kind: c.kind, app: c.app, name: 'Maya Chen', first: 'Maya', initials: 'MC'},
				closed: {
					kind: c.field, placeholder: c.field === 'filter' ? 'Search or ask' : c.field === 'alpha' ? 'Ask about Maya' : 'Text Maya', value: c.value,
					onText: c.field === 'alpha' ? null : (text: string) => { c.value = text; record('onText')(text); api.set({}); },
					submit: c.field === 'person' ? record('submit') : null, canSubmit: true, maxLength: c.field === 'person' ? 1600 : null,
					suggestion: c.suggestion, acceptSuggestion: c.suggestion ? () => { c.value = c.suggestion; c.suggestion = null; record('accept')(); api.set({}); } : null,
				},
				left: {icon: 'avatar', label: 'Back to texting Maya', initials: 'MC', run: record('left')},
				context: `Maya Chen · ${c.app}`, contextKey: `${view}:${c.kind}:maya`,
				strip: {title: 'Maya Chen', subtitle: c.app, initials: 'MC', live: !!c.end, actions: c.end ? [{id: 'mute', label: 'Mute', run: record('mute')}, {id: 'end', label: 'End call', run: record('stripEnd')}] : []},
				end: c.end ? record('end') : null, incoming: null, emergency: !!c.emergency, fit: null, briefing: null,
			};
		};
		// The shell instance, found from its root element.
		w.__shell = () => {
			const element = document.querySelector('[data-screen]') as any;
			let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))!];
			while (fiber && !(fiber.stateNode && typeof fiber.stateNode.cardAct === 'function')) fiber = fiber.return;
			return fiber.stateNode;
		};
		w.__shell().setState({});
	}, {view, config});
}
const shell = (page: Page, script: string) => page.evaluate(script);
const calls = (page: Page) => page.evaluate(() => (window as any).__calls as unknown[][]);
const panel = (page: Page) => page.locator('[data-alpha-layer="conversation"]');
const settled = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.timeline instanceof DocumentTimeline && animation.effect?.getComputedTiming().endTime !== Infinity).map(animation => animation.finished.catch(() => {}))));
const sheetHeight = (page: Page) => panel(page).evaluate(element => element.getBoundingClientRect().height);
const visibleComposers = (page: Page) => page.locator('[data-alpha-composer]').filter({visible: true});

async function openNotes(page: Page, theme = 'light') {
	await page.setViewportSize({width: 412, height: 915});
	await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind: 'offline'})));
	await page.goto(`/?fixture=1&start=notes&theme=${theme}`);
	await expect(page.locator('[data-alpha-layer="app"]')).toBeVisible();
}
async function openSheet(page: Page) {
	await page.getByRole('button', {name: 'Open Alpha', exact: true}).click();
	await expect(page.getByRole('button', {name: 'Resize chat', exact: true})).toBeVisible();
	await settled(page);
}

test.describe('comms shell (fixture dev build, test-only bar)', () => {
	test('the chip row is gone and each state has exactly one bar', async ({page}) => {
		await openNotes(page);
		await page.getByRole('button', {name: 'Open conversation', exact: true}).click();
		await expect(page.locator('[data-alpha-chat-suggestions]')).toHaveCount(0);
		await page.getByRole('button', {name: 'Minimize chat', exact: true}).click();
		await registerBar(page, 'notes');
		// Closed: the bar addresses the person, with Alpha on its left.
		await expect(visibleComposers(page)).toHaveCount(1);
		await expect(page.locator('[data-alpha-bar-field="person"]')).toBeVisible();
		await expect(page.getByRole('textbox', {name: 'Text Maya', exact: true})).toBeVisible();
		await expect(page.locator('[data-alpha-layer="pill"]')).toHaveCount(0);
		await openSheet(page);
		await expect(visibleComposers(page)).toHaveCount(1);
		await expect(page.locator('[data-alpha-chat-suggestions]')).toHaveCount(0);
		// Open: the bar addresses Alpha, outlined, and the left slot holds the person.
		await expect(page.getByRole('textbox', {name: 'Ask Alpha', exact: true})).toBeVisible();
		await expect(page.locator('.alpha-chat-composer.alpha-bar-field-alpha')).toBeVisible();
		await expect(page.locator('[data-alpha-sheet-context]')).toHaveText('Maya Chen · Messages');
		await expect(page.getByRole('button', {name: 'Back to texting Maya', exact: true})).toBeVisible();
		await page.getByRole('button', {name: 'Expand chat', exact: true}).click();
		await expect(page.locator('[data-alpha-strip]')).toBeVisible();
		await expect(visibleComposers(page)).toHaveCount(1);
		await expect(page.locator('[data-alpha-chat-suggestions]')).toHaveCount(0);
		// A tap on the strip returns to the open height.
		await page.locator('[data-alpha-strip] .alpha-strip-main').click();
		await expect(page.getByRole('button', {name: 'Resize chat', exact: true})).toBeVisible();
		await expect(page.locator('[data-alpha-strip]')).toHaveCount(0);
		// The left slot swaps the target: the chat closes onto the person's bar, then the view's step runs.
		await page.getByRole('button', {name: 'Back to texting Maya', exact: true}).click();
		await expect(page.getByRole('textbox', {name: 'Text Maya', exact: true})).toBeVisible();
		await expect.poll(async () => (await calls(page)).filter(call => call[1] === 'left').length).toBe(1);
	});

	test('the person field owns its text: no Alpha send on Enter, Send is the view\'s own', async ({page}) => {
		await openNotes(page);
		await registerBar(page, 'notes');
		const field = page.getByRole('textbox', {name: 'Text Maya', exact: true});
		await field.fill('See you at 3');
		await field.press('Enter');
		expect(await shell(page, 'window.__shell().S().msgs.length')).toBe(0);
		await expect(field).toHaveValue(/See you at 3/);
		await page.locator('[data-alpha-bar-send]').click();
		expect((await calls(page)).filter(call => call[1] === 'submit')).toHaveLength(1);
		expect(await shell(page, 'window.__shell().S().msgs.length')).toBe(0);
	});

	test('a list filter filters as words are typed; a sentence waits for Enter, which asks Alpha', async ({page}) => {
		await openNotes(page);
		await registerBar(page, 'notes', {kind: 'list', field: 'filter'});
		const field = page.getByRole('textbox', {name: 'Search or ask', exact: true});
		await field.pressSequentially('maya');
		await expect.poll(async () => (await calls(page)).filter(call => call[1] === 'onText').at(-1)?.[2]).toBe('maya');
		await field.pressSequentially(' when did we last talk');
		await expect(page.locator('[data-alpha-bar-hint]')).toHaveText('Enter asks Alpha');
		expect((await calls(page)).filter(call => call[1] === 'onText').at(-1)?.[2]).toBe('maya when did ');
		expect(await shell(page, 'window.__shell().S().msgs.length')).toBe(0);
		await field.press('Enter');
		await expect.poll(() => shell(page, 'window.__shell().S().msgs.filter(m => m.from === "user").map(m => m.text)')).toEqual(['maya when did we last talk']);
		expect((await calls(page)).filter(call => call[1] === 'onText').at(-1)?.[2]).toBe('');
	});

	test('a card tap that opens a comms view rests on its bar, never the pill', async ({page}) => {
		await openNotes(page);
		await registerBar(page, 'notes');
		await shell(page, 'window.__shell().goHome()');
		await expect(page.locator('[data-alpha-layer="app"]')).toHaveCount(0);
		await shell(page, 'window.__shell().agentSay("Your notes", {type: "generic", title: "Notes", sub: "Open", go: {view: "notes"}})');
		await page.getByRole('button', {name: /Notes/}).filter({hasText: 'Open'}).click();
		await expect(page.locator('[data-alpha-layer="app"]')).toBeVisible();
		await expect(page.locator('[data-alpha-layer="pill"]')).toHaveCount(0);
		await expect(page.getByRole('textbox', {name: 'Text Maya', exact: true})).toBeVisible();
		// A direct hidden chat still shows the bar, not the pill (D2).
		await shell(page, 'window.__shell().setState({chat: "hidden"})');
		await expect(page.locator('[data-alpha-layer="pill"]')).toHaveCount(0);
		await expect(page.getByRole('textbox', {name: 'Text Maya', exact: true})).toBeVisible();
	});

	test('the stage sits above the sheet at open and throughout a drag', async ({page}) => {
		await openNotes(page);
		await registerBar(page, 'notes', {kind: 'list', field: 'filter'});
		// The list's first visible row is what must stay above the sheet.
		await page.locator('[data-alpha-note-id]').first().evaluate(row => row.setAttribute('data-alpha-stage-last', ''));
		await openSheet(page);
		const layer = page.locator('[data-alpha-layer="app"]');
		await expect(layer).toHaveAttribute('data-alpha-stage', 'true');
		const gap = () => page.evaluate(() => {
			const last = document.querySelector('[data-alpha-stage-last]')!.getBoundingClientRect();
			const sheet = document.querySelector('[data-alpha-layer="conversation"]')!.getBoundingClientRect();
			return sheet.top - last.bottom;
		});
		expect(await gap()).toBeGreaterThanOrEqual(0);
		const box = (await page.getByRole('button', {name: 'Resize chat', exact: true}).boundingBox())!;
		const x = box.x + box.width / 2, y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		for (const dy of [-40, -120, -220, 40]) {
			await page.mouse.move(x, y + dy, {steps: 6});
			expect(await page.locator('[data-screen]').getAttribute('data-alpha-chat-dragging')).toBe('true');
			expect(await gap(), `mid-drag ${dy}`).toBeGreaterThanOrEqual(0);
		}
		await page.mouse.move(x, y, {steps: 4});
		await page.mouse.up();
		await settled(page);
		expect(await gap()).toBeGreaterThanOrEqual(0);
		// A size tap right after a drag is that drag's own release, so the next tap waits it out.
		await page.waitForTimeout(400);
		await page.getByRole('button', {name: 'Expand chat', exact: true}).click();
		await expect(page.locator('[data-alpha-strip]')).toBeVisible();
		await expect(layer).toHaveAttribute('inert', '');
	});

	test('End is beside the closed bar and stays reachable during a drag', async ({page}) => {
		await openNotes(page);
		await registerBar(page, 'notes', {kind: 'call', field: 'alpha', end: true, app: 'Call'});
		const end = page.locator('[data-alpha-bar-end]');
		await expect(end).toBeVisible();
		const hit = () => end.evaluate(button => { const box = button.getBoundingClientRect(); return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('[data-alpha-bar-end]') === button; });
		expect(await hit()).toBe(true);
		await end.click();
		expect((await calls(page)).filter(call => call[1] === 'end')).toHaveLength(1);
		// The closed bar for a call addresses Alpha, outlined.
		await expect(page.locator('[data-alpha-input-bar].alpha-bar-field-alpha')).toBeVisible();
		const bar = (await page.locator('[data-alpha-input-drag-background]').boundingBox())!;
		await page.mouse.move(bar.x + 60, bar.y + bar.height / 2);
		await page.mouse.down();
		await page.mouse.move(bar.x + 60, bar.y - 160, {steps: 8});
		expect(await hit()).toBe(true);
		await page.mouse.up();
		await settled(page);
		// Open: End leaves the bar (the call card has it); full: End is in the strip.
		await expect(end).toHaveCount(0);
		await page.getByRole('button', {name: 'Expand chat', exact: true}).click();
		await page.locator('[data-alpha-strip-action="end"]').click();
		expect((await calls(page)).filter(call => call[1] === 'stripEnd')).toHaveLength(1);
	});

	test('a stage switch keeps the sheet; Back returns the stage first, then closes the chat', async ({page}) => {
		await openNotes(page);
		await registerBar(page, 'notes', {kind: 'thread'});
		await registerBar(page, 'calendar', {kind: 'call', field: 'alpha', end: true, app: 'Call'});
		await openSheet(page);
		const before = await sheetHeight(page), stack = await shell(page, 'JSON.stringify(window.__shell().S().stack)');
		await shell(page, 'window.__shell().api("notes").stage("calendar", null, null)');
		await expect.poll(() => shell(page, 'window.__shell().S().view')).toBe('calendar');
		await settled(page);
		expect(Math.abs(await sheetHeight(page) - before)).toBeLessThan(1);
		await expect(page.locator('[data-alpha-stage-return]')).toHaveText('‹ Messages');
		expect(await shell(page, 'window.__shell().S().chat')).toBe('sheet');
		await shell(page, 'window.__shell().back()');
		await expect.poll(() => shell(page, 'window.__shell().S().view')).toBe('notes');
		expect(await shell(page, 'window.__shell().S().chat')).toBe('sheet');
		await expect(page.locator('[data-alpha-stage-return]')).toHaveCount(0);
		expect(await shell(page, 'JSON.stringify(window.__shell().S().stack)')).toBe(stack);
		await shell(page, 'window.__shell().back()');
		await expect.poll(() => shell(page, 'window.__shell().S().chat')).toBe('input');
		expect(await shell(page, 'window.__shell().S().view')).toBe('notes');
		expect(await shell(page, 'window.__shell().S().stageFrom.length')).toBe(0);
	});

	test('a faint suggestion fills the field and sends nothing', async ({page}) => {
		await openNotes(page);
		await registerBar(page, 'notes', {suggestion: 'Yes! See you at 3'});
		const faint = page.locator('[data-alpha-faint]');
		await expect(faint).toHaveAttribute('aria-label', 'Suggestion: Yes! See you at 3, double-tap to use');
		await faint.click();
		await expect(page.getByRole('textbox', {name: 'Text Maya', exact: true})).toHaveValue('Yes! See you at 3');
		await expect(faint).toHaveCount(0);
		expect((await calls(page)).filter(call => call[1] === 'submit')).toHaveLength(0);
		// Open: the installed source offers one specific next request; a swipe right takes it.
		await page.evaluate(async () => { const {setOpenSuggestionSource} = await import('/src/runtime/comms-bar.ts'); setOpenSuggestionSource(input => input.spec ? 'When did Maya last call?' : null); });
		await openSheet(page);
		const open = page.locator('[data-alpha-faint]');
		await expect(open).toContainText('When did Maya last call?');
		const box = (await open.boundingBox())!;
		await page.mouse.move(box.x + 10, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + 90, box.y + box.height / 2, {steps: 5});
		await page.mouse.up();
		await expect(page.getByRole('textbox', {name: 'Ask Alpha', exact: true})).toHaveValue('When did Maya last call?');
		expect(await shell(page, 'window.__shell().S().msgs.length')).toBe(0);
	});

	test('a proposal replaced by a newer one never acts; an emergency drops acting proposals', async ({page}) => {
		await openNotes(page);
		await registerBar(page, 'notes');
		await page.evaluate(async () => {
			const {VIEWS} = await import('/src/prototype/model.js');
			(VIEWS.notes.actions ||= {}).testCall = () => { (window as any).__calls.push(['notes', 'acted']); };
		});
		const proposal = (id: string) => `({id: "${id}", kind: "call", title: "Call Maya", detail: "(555) 010-0100", button: "Call", acts: true, act: {mod: "notes", fn: "testCall"}, args: {}})`;
		await shell(page, `window.__first = window.__shell().propose(${proposal('a')})`);
		const second = await shell(page, `window.__shell().propose(${proposal('b')})`) as {shown: boolean; replaced: {id: string}[]};
		expect(second.shown).toBe(true);
		expect(second.replaced.map(item => item.id)).toEqual(['a']);
		await expect.poll(() => shell(page, 'window.__shell().S().msgs.map(m => m.card.state)')).toEqual(['replaced', 'open']);
		await shell(page, 'window.__shell().cardAct(window.__shell().S().msgs[0])');
		expect((await calls(page)).filter(call => call[1] === 'acted')).toHaveLength(0);
		await shell(page, 'window.__shell().cardAct(window.__shell().S().msgs[1])');
		await expect.poll(async () => (await calls(page)).filter(call => call[1] === 'acted').length).toBe(1);
		await expect.poll(() => shell(page, 'window.__shell().S().msgs[1].card.state')).toBe('done');
		await shell(page, 'window.__shell().cardAct(window.__shell().S().msgs[1])');
		expect((await calls(page)).filter(call => call[1] === 'acted')).toHaveLength(1);
		await page.evaluate(() => { (window as any).__bar.notes.emergency = true; });
		expect(await shell(page, `window.__shell().propose(${proposal('c')})`)).toEqual({shown: false, replaced: []});
	});

	for (const theme of ['light', 'dark']) test(`shell surfaces meet contrast in ${theme}`, async ({page}) => {
		await openNotes(page, theme);
		await registerBar(page, 'notes', {kind: 'call', field: 'alpha', end: true, app: 'Call', suggestion: null});
		const audit = () => page.evaluate(() => {
			const rgb = (value: string) => (value.match(/[\d.]+/g) || []).map(Number);
			const lum = ([r, g, b]: number[]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
			const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
			const background = (element: Element | null, skip = false): number[] => {
				for (let node = skip ? element?.parentElement : element; node; node = node.parentElement) { const c = rgb(getComputedStyle(node).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0.5) return c; }
				return [255, 255, 255];
			};
			const out: string[] = [];
			for (const [selector, min] of [['[data-alpha-sheet-context]', 4.5], ['.alpha-strip-text b', 4.5], ['.alpha-strip-text span', 4.5], ['[data-alpha-stage-return]', 4.5], ['[data-alpha-input-bar] textarea', 4.5]] as const)
				for (const element of document.querySelectorAll(selector)) { const r = ratio(rgb(getComputedStyle(element).color), background(element)); if (r < min) out.push(`${selector} text ${r.toFixed(2)}`); }
			for (const selector of ['[data-alpha-bar-end]', '.alpha-strip-action.alpha-end-button'])
				for (const element of document.querySelectorAll(selector)) { const r = ratio(background(element), background(element, true)); if (r < 3) out.push(`${selector} control ${r.toFixed(2)}`); }
			return out;
		});
		expect(await audit()).toEqual([]);
		await openSheet(page);
		await shell(page, 'window.__shell().api("notes").stage("notes", null, null)');
		await expect(page.locator('[data-alpha-stage-return]')).toBeVisible();
		expect(await audit()).toEqual([]);
		await page.getByRole('button', {name: 'Expand chat', exact: true}).click();
		await expect(page.locator('[data-alpha-strip]')).toBeVisible();
		expect(await audit()).toEqual([]);
	});
});
