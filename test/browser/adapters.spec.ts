import { test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const run=promisify(execFile);
for(const script of ['test-cloud-delegation.mjs','test-cloud-delegation-return.mjs','test-agent-context-browser.mjs','test-browser-bookmark-recovery.mjs','test-inbox-drafts-browser.mjs','test-maps-context-browser.mjs','test-notes-documents-browser.mjs','test-hosted-live-source-picker.mjs']) {
  test(`rendered adapter: ${script}`,async({},info)=>{
    test.setTimeout(60_000);
    const baseURL=info.project.use.baseURL||'http://127.0.0.1:5317';
    await run(process.execPath,[`scripts/${script}`],{timeout:55_000,env:{...process.env,
      ALPHA_BROWSER_MODULES:path.resolve('node_modules'),
      ALPHA_HOSTED_TEST_OUTPUT:info.outputPath('fixture'),
      ALPHA_CONTEXT_TEST_URL:baseURL,ALPHA_MAPS_TEST_URL:baseURL,
      ALPHA_INBOX_TEST_URL:baseURL,ALPHA_NOTES_TEST_URL:baseURL,
    }});
  });
}
