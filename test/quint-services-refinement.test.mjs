import test from 'node:test';
import assert from 'node:assert/strict';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {authorizationRefinement} from '../specs/quint/refinement/services/authorization.mjs';
import {googleAccountsRefinement} from '../specs/quint/refinement/services/google-accounts.mjs';
import {googleAccountsLifecycleRefinement} from '../specs/quint/refinement/services/google-accounts-lifecycle.mjs';
import {calendarRefinement} from '../specs/quint/refinement/services/calendar.mjs';
import {calendarLinkedRefinement} from '../specs/quint/refinement/services/calendar-linked.mjs';
import {inboxRefinement} from '../specs/quint/refinement/services/inbox.mjs';
import {mapsRefinement} from '../specs/quint/refinement/services/maps.mjs';
import {cacheRefinement} from '../specs/quint/refinement/services/cache.mjs';
import {workflowRefinement} from '../specs/quint/refinement/services/workflow.mjs';
import {policyRefinement} from '../specs/quint/refinement/services/policies.mjs';
import {readingRefinement} from '../specs/quint/refinement/services/reading.mjs';
import {scanRefinement} from '../specs/quint/refinement/services/scan.mjs';
import {credentialRefinement} from '../specs/quint/refinement/services/credentials.mjs';
import {pdfRefinement} from '../specs/quint/refinement/services/pdf.mjs';

// Service source campaigns whose adapters cover several models. Each runs the product source
// against its models' transitions; a model with a single adapter has its own test file.
for (const check of [authorizationRefinement, googleAccountsRefinement, googleAccountsLifecycleRefinement,
  calendarRefinement, calendarLinkedRefinement, inboxRefinement, mapsRefinement, cacheRefinement, workflowRefinement,
  policyRefinement, readingRefinement, scanRefinement, credentialRefinement, pdfRefinement]) {
  test(`${check.name} checks service source traces against the Quint models`, {timeout: scaledTimeout(600000)}, async () => {
    const result = await check();
    const receipts = result?.receipts ?? (Array.isArray(result) ? result : [result?.receipt ?? result]);
    assert.ok(receipts.length > 0);
    for (const receipt of receipts) assert.equal(receipt.passed, true, receipt.model);
  });
}
