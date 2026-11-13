import {scaledTimeout} from '../../specs/quint/refinement/timeouts.mjs';
import { test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const run=promisify(execFile);
for(const script of ['test-cloud-delegation.ts','test-cloud-delegation-return.ts','test-agent-context-browser.ts','test-browser-bookmark-recovery.ts','test-inbox-drafts-browser.ts','test-maps-context-browser.ts','test-notes-documents-browser.ts','test-hosted-live-source-picker.ts']) {
  test(`rendered adapter: ${script}`,async({},info)=>{
    test.setTimeout(scaledTimeout(60_000));
    const baseURL=info.project.use.baseURL||'http://127.0.0.1:5317';
    await run(process.execPath,[`scripts/${script}`],{timeout:scaledTimeout(55_000),env:{...process.env,
      ALPHA_BROWSER_MODULES:path.resolve('node_modules'),
      ALPHA_HOSTED_TEST_OUTPUT:info.outputPath('fixture'),
      ALPHA_CONTEXT_TEST_URL:baseURL,ALPHA_MAPS_TEST_URL:baseURL,
      ALPHA_INBOX_TEST_URL:baseURL,ALPHA_NOTES_TEST_URL:baseURL,
    }});
  });
}
