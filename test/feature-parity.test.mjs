// Alpha and Eliza are two brands of one shared mobile application: their functional feature
// manifests (the shared mobileFeatureManifest emitter over each product registration) may differ
// only by identity and theme. The differences still open, and the Alpha source that still owns
// behaviour, are listed in test/support/feature-parity.mjs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {featureParity} from '../scripts/feature-manifest.ts';
import {featureParityAllowlist as allowlist} from './support/feature-parity.mjs';

const parity = await featureParity();
const regenerate = 'Run bun scripts/feature-manifest.ts --parity to see the current lists.';

test('Alpha and Eliza differ functionally only where the allowlist says so', () => {
  const allowed = Object.keys(allowlist.differences);
  const unexplained = parity.differences.filter(key => !allowed.includes(key));
  assert.deepEqual(unexplained, [], `New functional difference from Eliza. List it in test/support/feature-parity.mjs with its owning module, or move the behaviour upstream. ${regenerate}`);
  const closed = allowed.filter(key => !parity.differences.includes(key));
  assert.deepEqual(closed, [], `These differences are closed: remove them from test/support/feature-parity.mjs. ${regenerate}`);
  for (const [key, owner] of Object.entries(allowlist.differences))
    assert.ok(typeof owner === 'string' && owner.trim(), `${key} names the Alpha module or decision that owns it`);
});

test('every Alpha-owned behavioural module is listed; moved modules leave the allowlist', () => {
  const listed = new Set(allowlist.modules);
  const added = parity.modules.filter(file => !listed.has(file));
  assert.deepEqual(added, [], `Unlisted Alpha-owned behaviour. Add it to test/support/feature-parity.mjs. ${regenerate}`);
  const gone = allowlist.modules.filter(file => !parity.modules.includes(file));
  assert.deepEqual(gone, [], `These modules are gone: remove them from test/support/feature-parity.mjs. ${regenerate}`);
  assert.deepEqual(allowlist.modules, [...allowlist.modules].sort(), 'modules stay sorted');
});


test('reviewed product helpers retain an inventoried owner and focused validation', () => {
  for (const [module, review] of Object.entries(allowlist.reviewedHelpers)) {
    assert.ok(allowlist.modules.includes(module), `${module} remains in the exact inventory`);
    assert.ok(allowlist.modules.includes(review.owner), `${module} names its existing owning module`);
    assert.ok(review.reason.trim(), `${module} explains the extracted behavior`);
    assert.ok(review.tests.length > 0 && review.tests.every(file => fs.existsSync(file)), `${module} names retained focused validation`);
  }
});

test('branding never counts as a functional difference, and the launcher is shared by both brands', () => {
  assert.equal(allowlist.reference, 'ELIZA_MOBILE_PRODUCT');
  assert.equal(parity.alpha.branding.appId, 'ai.alphacompute.alphaphone');
  assert.equal(parity.eliza.branding.appId, 'ai.elizaos.app');
  assert.equal(parity.alpha.branding.storage.launcherFavorites, 'alpha.launcher.favorites.v1');
  assert.equal(parity.eliza.branding.storage.launcherFavorites, 'eliza.launcher.favorites.v1');
  for (const capability of ['launcher.installed-apps', 'launcher.default-dial', 'launcher.favorites']) {
    assert.ok(parity.alpha.functional.capabilities.includes(capability), `Alpha provides ${capability}`);
    assert.ok(parity.eliza.functional.capabilities.includes(capability), `Eliza provides ${capability}`);
  }
  assert.ok(!parity.differences.some(key => key.startsWith('capability:launcher.')), 'one launcher for both brands');
  // Identity-only fields of the two records never surface in the functional part.
  assert.doesNotMatch(JSON.stringify(parity.alpha.functional), /alpha|Alpha/);
});

test('the Alpha manifest is deterministic and served views appear on both sides', async () => {
  const again = await featureParity();
  assert.equal(JSON.stringify(again.alpha), JSON.stringify(parity.alpha));
  const calendar = parity.alpha.functional.views.find(view => view.id === 'calendar');
  assert.deepEqual(calendar?.serves, ['reminders']);
});
