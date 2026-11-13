// Partial source contract regression evidence. Original schedules, actions and assertions are retained.
// Only the selected source members/components and controlled ports execute; this is not whole-file refinement.
import {after as afterPartialContract} from 'node:test';
import partialContractAssert from 'node:assert/strict';
import {fileURLToPath as partialContractFile} from 'node:url';
import {captureReplayClosure as capturePartialClosure} from '../specs/quint/refinement/observed-replay.mjs';
import {captureInputs as capturePartialInputs} from '../specs/quint/refinement/check-traces.mjs';
const partialContractInputs = capturePartialClosure([partialContractFile(import.meta.url)]);
afterPartialContract(() => partialContractAssert.deepEqual(capturePartialInputs(Object.keys(partialContractInputs)), partialContractInputs));

import test from 'node:test';
import assert from 'node:assert/strict';
import {checkAddressInput, corpus, describe} from '../specs/quint/refinement/application/address-input.mjs';

test("partial source contract: the address bar decides every corpus text and model submission as AddressInput does", {timeout: 240000}, async () => {
  const receipt = await checkAddressInput();
  assert.equal(receipt.corpusChecks, corpus.length * 2);
  assert.ok(receipt.classes >= 15, `property classes ${receipt.classes}`);
  assert.ok(receipt.replayed > 30, `model submissions replayed ${receipt.replayed}`);
});

test("partial source contract: the corpus covers each kind of typed text the model names", () => {
  const found = corpus.map(describe);
  for (const [name, holds] of Object.entries({
    'too long': input => input.tooLong, 'time': input => input.timeLike, 'web address': input => input.webScheme && input.verdict === 'url',
    'simple @ search': input => input.simpleAtSearch && input.reason === 'credentials', 'credentials': input => input.reason === 'credentials' && !input.simpleAtSearch,
    'unsafe @ search verdict': input => input.verdict === 'search' && input.hasAt && !input.simpleAtSearch,
    'unsafe @ time correction': input => input.timeLike && input.hasAt && !input.simpleAtSearch,
    'unsafe @ localhost alias': input => input.localhostAlias && input.hasAt && !input.simpleAtSearch,
    'other scheme': input => input.reason === 'unsupported-protocol' && !input.hasAt, 'scheme with @': input => input.reason === 'unsupported-protocol' && input.hasAt,
    'short decimal': input => input.shortDecimal && input.verdict === 'url', 'localhost': input => input.localhostAlias, 'words': input => input.verdict === 'search' && !input.localhostAlias,
    'host': input => input.verdict === 'url' && !input.timeLike && !input.shortDecimal && !input.webScheme}))
    assert.ok(found.some(holds), name);
});
