import {ALPHA_PRODUCT_REGISTRATION as record} from '../apps/app/src/product/alpha-product-registration.ts';
import test from 'node:test';
import assert from 'node:assert/strict';

const palette = record.theme.palette ?? {};

test('palette entries are colours under Alpha product property names', () => {
  for (const [name, value] of Object.entries(palette)) {
    assert.match(name, /^--alpha-[a-z0-9]+(?:-[a-z0-9]+)*$/, name);
    const values = typeof value === 'string' ? [value] : [value.light, value.dark];
    for (const color of values) assert.match(color, /^#[0-9A-F]{6}(?:[0-9A-F]{2})?$/, `${name}: ${color}`);
  }
});
