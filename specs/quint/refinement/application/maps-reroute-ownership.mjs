import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {expect as baseExpect} from '@playwright/test';
import {geo, mountClosedMaps, route, start} from '../../legacy/maps/check-maps-refinement.mjs';
import {checkTraces, qset} from '../check-traces.mjs';
import {call} from './support.mjs';

const expect = baseExpect.configure({timeout: 15000});
const model = 'MapsRerouteOwnership';
const modelPath = 'specs/quint/application/'+model+'.qnt';
const origin = {latitude: 43.738, longitude: 7.424};
const destination = {latitude: 43.741, longitude: 7.424};
const offRoute = {latitude: 43.75, longitude: 7.424};
const replacement = {latitude: 43.736, longitude: 7.425};
const routeIds = ['route1_fixture_0123456789', 'route_A_fixture_0123456789', 'route_B_fixture_0123456789'];
const origins = [origin, offRoute, replacement];
const button = (page, name) => page.getByRole('button', {name, exact: true});
const wait = (page, count) => page.waitForFunction(n => window.closedMaps.pendingRoutes.length === n, count);
const waitForAgent = page => page.waitForFunction(() => window.closedMaps.agentResult !== null);
const status = page => page.locator('[data-alpha-maps-status] [role="status"]');
const unrecorded = {point: async () => {}};

function routeOrigin(point) {
  if (!point) return 0;
  const index = origins.findIndex(row => row.latitude === point.latitude && row.longitude === point.longitude);
  assert.ok(index >= 0, 'The published origin belongs to an exact submitted request');
  return index + 1;
}

async function observe(page) {
  const raw = await page.evaluate(() => {
    const f = window.closedMaps;
    return {...window.inspectHistoricalMaps(), agent: f.agentResult, agentSession: f.agentSession ?? 0,
      pending: f.pendingRoutes.map(row => ({aborted: row.signal.aborted, settled: row.settled})),
      requests: f.requests.filter(row => row.endpoint === 'routes').map(row => row.body),
      watches: window.closedMapsGeo.watches.size};
  });
  for (const body of raw.requests) {
    assert.deepEqual(body.to, destination);
    assert.equal(body.mode, 'drive');
  }
  let result = 'none';
  if (raw.agent === null) result = 'pending';
  else if (raw.agent?.ok) {
    assert.deepEqual(raw.agent.value, {state:'navigating', placeName:'Fixture destination', travelMode:'drive'});
    result = 'accepted';
  } else if (raw.agent) {
    const {code, message} = raw.agent;
    if (code === 'MAPS_DEVICE_UNAVAILABLE' && message.includes('Navigation ended')) result = 'retired';
    else if (code === 'MAPS_DEVICE_UNAVAILABLE' && message.includes('kept the previous route')) result = 'kept';
    else if (code === 'MAPS_PROVIDER_UNAVAILABLE') result = 'refused';
    else throw Error('Unexpected Maps reroute outcome '+JSON.stringify(raw.agent));
  }
  const publicId = route => {
    if (!route) return 0;
    assert.ok(routeIds.includes(route), 'Known synthetic public route ID');
    return routeIds.indexOf(route) + 1;
  };
  return {
    's.session': raw.session,
    's.guidanceSession': raw.guidance?.session ?? 0,
    's.guidanceRoute': publicId(raw.guidance?.routeId),
    's.rerouting': raw.guidance?.rerouting ?? false,
    's.fixReady': !!raw.guidance?.fix,
    's.phase': raw.route?.phase ?? 'none',
    's.route': publicId(raw.route?.value?.id),
    's.origin': routeOrigin(raw.route?.value?.from),
    's.requestOrigins': raw.requests.map(row => routeOrigin(row.from)),
    's.pending': qset(raw.pending.flatMap((row, index) => row.settled ? [] : [index + 2])),
    's.aborted': qset(raw.pending.flatMap((row, index) => row.aborted ? [index + 2] : [])),
    's.watches': raw.watches,
    's.agent': result,
    's.agentSession': raw.agentSession,
    's.settledFor': raw.publication?.session ?? 0,
  };
}

async function begin(page, name) {
  await route(page, unrecorded);
  const trace = {name, init: call('init'), expect: await observe(page), steps: []};
  const point = async (label, action) => {
    const expect = await observe(page);
    trace.steps.push({label, action, expect});
    return expect;
  };
  await start(page, unrecorded);
  await point('User starts the exact accepted route and owns one location watch', call('start'));
  await geo(page, offRoute);
  await expect(status(page)).toContainText('Off route.');
  await page.waitForFunction(() => !!window.closedMaps.agentPort.current);
  await point('Synthetic precise off-route fix makes the same guidance eligible', call('fix'));
  await page.evaluate(() => {
    const f = window.closedMaps;
    f.holdRouteReplies = true;
    f.agentResult = null;
    f.agentSession = window.inspectHistoricalMaps().guidance.session;
    void f.agentPort.current.reroute().then(value => { f.agentResult = {ok:true, value}; },
      error => { f.agentResult = {ok:false, code:error.code, message:error.message}; });
  });
  await wait(page, 1);
  await point('Registered agent requests reroute from that exact fix', call('agentReroute'));
  return {trace, point};
}

async function reply(page, request, publicId) {
  await page.evaluate(({index, id}) => {
    const held = window.closedMaps.pendingRoutes[index];
    held.settled = true;
    held.settle(id ? {id} : {refuse:true});
  }, {index:request - 2, id:routeIds[publicId - 1]});
}

async function live(page, publicId) {
  const t = await begin(page, publicId === 1 ? 'live_same_public_route_id'
    : publicId === 2 ? 'live_new_public_route_id' : 'live_provider_refusal');
  if (publicId === 1) {
    await expect(button(page, 'Reroute from here')).toHaveCount(0);
    await page.evaluate(() => {void window.closedMaps.agentPort.current.reroute().catch(() => {});});
    await t.point('A second registered reroute during the held request dispatches no extra request', call('duplicateTap'));
  }
  await reply(page, 2, publicId);
  await waitForAgent(page);
  await t.point('The exact live request settles through its own result', call('routeReply', 2, publicId));
  return t.trace;
}

async function end(page, t) {
  await button(page, 'End navigation').click();
  await expect(button(page, 'End navigation')).toHaveCount(0);
  await t.point('End retires guidance and its watch while route planning can settle', call('end'));
}

async function ended(page) {
  const t = await begin(page, 'end_without_new_route_preserves_review');
  await end(page, t);
  await reply(page, 2, 2);
  await waitForAgent(page);
  await t.point('The ended guidance stays retired while the admitted route remains in review', call('routeReply', 2, 2));
  return t.trace;
}

async function replaced(page, retiredPublicId, early) {
  const t = await begin(page, early ? 'retired_reply_before_replacement_start'
    : retiredPublicId ? 'retired_success_after_replacement_start' : 'retired_refusal_after_replacement_start');
  await end(page, t);
  const input = page.getByRole('textbox', {name:'Starting point', exact:true});
  await expect(input).toBeVisible();
  await input.fill(replacement.latitude+', '+replacement.longitude);
  await input.press('Enter');
  await wait(page, 2);
  await t.point('Explicit replacement origin aborts the old request in the same component', call('replan'));
  const retire = async () => {
    await reply(page, 2, retiredPublicId);
    await waitForAgent(page);
    await t.point('The old agent result must not report a replacement guidance session', call('routeReply', 2, retiredPublicId));
  };
  if (early) await retire();
  await reply(page, 3, 3);
  await expect(button(page, 'Start')).toBeVisible();
  await t.point('The replacement route is ready for review under its own request', call('routeReply', 3, 3));
  await start(page, unrecorded);
  await t.point('A separate real Start establishes replacement guidance in the same component', call('start'));
  if (!early) await retire();
  return t.trace;
}

async function captureMapsRerouteOwnership(extraSources = []) {
  return mountClosedMaps([fileURLToPath(import.meta.url), ...extraSources],
    [page => live(page, 1), page => live(page, 2), page => live(page, 0), ended,
      page => replaced(page, 2, false), page => replaced(page, 0, false), page => replaced(page, 2, true)], true);
}

export async function checkMapsRerouteOwnership(extraSources = []) {
  const {results:traces, sources, driverHashes} = await captureMapsRerouteOwnership(extraSources);
  return checkTraces({model, modelPath, sources, driverHashes, traces, scope:'bounded-orchestration', assumptions:[
    'Actual flag-off Maps template, registered agent port and shared controllers run together in one mounted document. The account transport, location fixes and map style are closed synthetic ports.',
    'All routes use the same exact synthetic destination and drive mode. Distinct original, off-route and replacement coordinates partition origins. Public route IDs may repeat across requests.',
    'The observer reads screen guidance and controller route snapshots. Held responses can finish after their AbortSignal is cancelled. The schedules cover replacement and selected refusal orders, not the native service, real provider, or installed location.',
  ]});
}
