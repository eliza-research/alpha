import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The Inbox and Maps sections of the shared template follow docs/flow-redesign-2026-11:
// pills are at least 44px tall with 8-14px between them, and no control asks for coordinates.
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const template = read('apps/app/src/prototype/template.html');
const css = read('apps/app/src/prototype/phone.css');
const base = read('apps/app/src/prototype/prototype.css');
const section = (open, close) => { const at = template.indexOf(open); assert.ok(at >= 0, open); return template.slice(at, template.indexOf(close, at)); };
const inbox = section('<sc-if value="{{is.inbox}}">', '<sc-if value="{{is.calendar}}">');
const maps = section('<sc-if value="{{is.maps}}">', '<sc-if value="{{is.notes}}">');
const tag = (html, marker) => { const at = html.indexOf(marker); assert.ok(at >= 0, marker); return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1); };

test('Inbox pills and empty-state action are touch-sized', () => {
  assert.match(tag(inbox, 'onClick="{{action.pick}}"'), /min-height:44px;[^"]*border-radius:22px/);
  assert.match(tag(inbox, 'onClick="{{inbox.addAcct}}"'), /min-height: 44px;[^"]*background: var\(--fg\); color: var\(--bg\)/);
  assert.match(tag(inbox, 'onClick="{{inbox.d.ask}}"'), /min-height: 44px;[^"]*border-radius: 22px/);
  for (const handler of ['message.pick', 'inbox.d.previousThread', 'inbox.d.nextThread']) assert.match(tag(inbox, `onClick="{{${handler}}}"`), /min-height:44px;/, handler);
  // An open message's header holds only icon buttons; its text actions are 44px pills under the subject.
  const detailHeader = inbox.slice(inbox.indexOf('data-alpha-app-header="detail"'), inbox.indexOf('</div>', inbox.indexOf('data-alpha-app-header="detail"')));
  const actions = inbox.slice(inbox.indexOf('<div class="inbox-message-actions">'), inbox.indexOf('</div>', inbox.indexOf('<div class="inbox-message-actions">')));
  assert.ok(inbox.indexOf('{{inbox.d.subj}}') < inbox.indexOf('<div class="inbox-message-actions">'), 'text actions follow the subject');
  for (const handler of ['inbox.d.replyAll', 'inbox.d.toggleRead']) { assert.doesNotMatch(detailHeader, new RegExp(`\\{\\{${handler}\\}\\}`), handler); assert.ok(actions.includes(`onClick="{{${handler}}}"`), handler); }
  assert.doesNotMatch(detailHeader, /<button(?![^>]*class="ib")/, 'header buttons are all icon buttons');
  assert.match(css, /\.inbox-message-actions \{ display:flex; flex-wrap:wrap; gap:8px;/);
  assert.match(css, /\.inbox-message-actions button \{ min-height:44px;[^}]*border-radius:22px;/);
  assert.doesNotMatch(base + css, /\.tb\b/, 'no text-button class is left in the icon header');
  assert.match(inbox, /<div data-alpha-app-header="main" style="[^"]*padding: 0 16px; gap: 8px;/, 'search header spaces its back button');
});

test('Inbox review and recovery actions stack as 44px pills', () => {
  assert.match(css, /\.inbox-recovery-actions, \.inbox-provider-actions \{ display:flex; flex-direction:column; gap:8px;/);
  assert.match(css, /\.inbox-recovery-actions button, \.inbox-provider-actions button \{ min-height:44px;/);
  for (const handler of ['inbox.c.restoreEdits', 'inbox.c.retryEdits', 'inbox.c.useLatest']) assert.ok(inbox.slice(inbox.indexOf(`{{${handler}}}`) - 200, inbox.indexOf(`{{${handler}}}`)).includes('class="inbox-recovery-actions"'), handler);
  const provider = inbox.slice(inbox.indexOf('<div class="inbox-provider-actions">'));
  for (const handler of ['inbox.provider.confirm', 'inbox.provider.check', 'inbox.provider.clear']) assert.ok(provider.slice(0, provider.indexOf('</div>')).includes(`{{${handler}}}`), handler);
  assert.doesNotMatch(provider.slice(0, provider.indexOf('</div>')), /style="padding:14px"/);
  assert.match(tag(inbox, 'onClick="{{inbox.c.confirmDiscard}}"'), /min-height:44px;[^"]*background:#a32121/);
  assert.match(tag(inbox, 'onClick="{{inbox.contextReview.close}}"'), /class="ib" aria-label="Cancel"/);
  assert.match(tag(inbox, 'onClick="{{inbox.contextReview.send}}"'), /min-height:52px;margin-top:20px/);
  assert.match(inbox, />Reconnect Gmail to send\. Your draft stays on this device\.</);
  assert.doesNotMatch(inbox, /Enable Gmail changes/);
});

test('Maps never asks for coordinates and its pills are 44px', () => {
  assert.doesNotMatch(maps, /Enter coordinates|nativeManualLocation|Route origin coordinates|latitude/);
  assert.match(maps, /<sc-if value="\{\{maps\.nativeLocationHelp\}\}"><p[^>]*>\{\{maps\.nativeLocationHelp\}\}<\/p><\/sc-if>/);
  const origin = tag(maps, 'aria-label="Starting point"');
  assert.match(origin, /placeholder="Choose starting point"/);
  assert.match(origin, /height:44px;border:0;border-bottom:1px solid var\(--line\)/);
  assert.match(tag(maps, 'onClick="{{maps.originLocation}}"'), /aria-label="Use your location"[^>]*min-height:44px/);
  assert.match(tag(maps, 'onClick="{{maps.dr.start}}"'), /data-can-start="\{\{maps\.dr\.canStart\}\}"/);
  assert.match(tag(maps, 'onClick="{{maps.dr.start}}"'), /disabled="\{\{maps\.dr\.startDisabled\}\}" aria-disabled="\{\{maps\.dr\.startDisabled\}\}"/);
  assert.match(read('apps/app/src/prototype/maps-adapter.ts'), /canStart:!!route&&!navigating,startDisabled:!route\|\|navigating,/);
  assert.match(css, /\[data-alpha-maps-start\]\[data-can-start="false"\] \{ opacity:\.4; pointer-events:none; \}/);
  assert.match(maps, /<sc-if value="\{\{maps\.dr\.meta\}\}">/);
  assert.match(maps, /<sc-if value="\{\{maps\.dr\.nav\.meta\}\}">/);
  assert.match(tag(maps, 'onClick="{{md.go}}"'), /min-height: 44px; border-radius: 22px/);
  assert.match(maps, /gap: 8px; margin: 8px 0 0 8px">\n\s*<sc-for list="\{\{maps\.dr\.modes\}\}"/);
  for (const marker of ['onClick="{{c.go}}" style="flex-shrink: 0; height: 44px', 'onClick="{{maps.dr.nav.reroute}}" style="min-height: 44px']) assert.ok(maps.includes(marker), marker);
  for (const back of maps.matchAll(/<button data-alpha-maps-event-return[^>]*>/g)) assert.match(back[0], /height: 44px;[^"]*border-radius: 22px/);
  for (const button of maps.matchAll(/<button\b[^>]*>/g)) assert.doesNotMatch(button[0], /\b(min-)?height: ?(3\d|40)px/, button[0].slice(0, 120));
});

test('a Maps chat card that can open offers Show in Maps', () => {
  assert.match(template, /<sc-if value="\{\{card\.canOpen\}\}"><button class="maps-chat-card-open" onClick="\{\{card\.open\}\}">Show in Maps<\/button><\/sc-if><\/section>/);
  assert.match(css, /\.maps-chat-card-open \{[^}]*min-height:44px;/);
});
