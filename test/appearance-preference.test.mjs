import assert from 'node:assert/strict';
import test from 'node:test';
import {appearancePreferenceFixture} from './fixtures/appearance-preference.mjs';
import {checkAppearancePreferenceAdmission} from '../specs/quint/refinement/application/appearance-preference-admission.mjs';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';

for (const native of [false, true]) {
  test(`a flag-off ${native ? 'native' : 'browser'} query cannot disable the saved System choice`, () => {
    const f = appearancePreferenceFixture({native, queryTheme: 'light', initialStorage: 'system', initialScheme: 'dark'});
    assert.equal(f.observe().displayed, 'dark');
    f.mount();
    if (!native) f.commit();
    f.scheme('light');
    assert.equal(f.observe().pending.length, 1);
    f.commit();
    assert.equal(f.observe().displayed, 'light');
    assert.equal(f.observe().stored, 'system');
    assert.deepEqual(f.observe().attempts, []);
  });
}

test('a flag-off query cannot disable browser appearance storage readback', () => {
  const f = appearancePreferenceFixture({queryTheme: 'dark'});
  assert.equal(f.observe().displayed, 'light');
  f.mount();
  f.commit();
  f.storage('dark');
  assert.equal(f.observe().pending.length, 1);
  f.commit();
  assert.equal(f.observe().displayed, 'dark');
  assert.deepEqual(f.observe().attempts, []);
});

test('an admitted explicit development preview keeps its rendered theme', () => {
  const f = appearancePreferenceFixture({testMocksEnabled: true, queryTheme: 'light', initialStorage: 'system', initialScheme: 'dark'});
  f.mount();
  f.storage('dark');
  f.pageshow();
  f.scheme('light');
  assert.equal(f.observe().pending.length, 0);
  assert.equal(f.observe().displayed, 'light');
  assert.equal(f.observe().stored, 'dark');
  assert.deepEqual(f.observe().attempts, []);
});

test('actual appearance events and settled preference writes refine Quint', {timeout: scaledTimeout(180_000)}, async () => {
  const receipt = await checkAppearancePreferenceAdmission();
  assert.equal(receipt.passed, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 11);
});
