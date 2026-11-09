import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkEmailSuggestionReview} from '../specs/quint/refinement/application/email-suggestion-review.mjs';

test('the renderer review refines exact local email suggestion admission', async () => {
  const receipt = await checkEmailSuggestionReview([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 17);
});
