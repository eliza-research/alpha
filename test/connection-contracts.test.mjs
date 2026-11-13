import { test } from 'node:test';
import { runChildSuite } from './fixtures/child-suite.mjs';

// Exercise production adapters over synthetic loopback HTTP. These checks do
// not establish Cloud, enclave, Android Keystore, or physical-device acceptance.
for (const script of [
  'test-remote-protocol.ts',
]) {
  test(`connection contract: ${script}`, () => {
    runChildSuite(script, {timeout: 60_000});
  });
}
