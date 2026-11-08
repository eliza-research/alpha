import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import { defineConfig, devices } from '@playwright/test';
import { storageSpecPattern } from './scripts/storage-specs.mjs';
const port=Number(process.env.ALPHA_BROWSER_TEST_PORT||5317);
const productionPort=port+1;
// The production lane runs production-surface.spec.ts and every <name>.production.spec.ts.
const productionSpec=/(production-surface|\.production)\.spec\.ts$/;

// The top-level webServer list is not per-project. Start only the servers that the
// selected projects use, so the default lane never builds and the production lane
// never starts a flag-on development server.
const selected=(()=>{
  const names:string[]=[];const argv=process.argv;
  for(let index=0;index<argv.length;index++){
    if(argv[index]==='--project'&&argv[index+1])names.push(argv[++index]);
    else if(argv[index].startsWith('--project='))names.push(argv[index].slice('--project='.length));
  }
  return names;
})();
const needsProduction=!selected.length||selected.includes('production');
const needsDevelopment=!selected.length||selected.some(name=>name!=='production');
// Specs that start their own in-process Vite server (dev-hosted-journey, dev-reload,
// reading-source) read the flag from the worker environment, so development lanes opt in
// here too. The production web server below clears it explicitly.
if(needsDevelopment)process.env.ELIZA_DEV_ALLOW_TEST_MOCKS='1';

// Tests must never inherit the human preview’s private Cloud account profile.
const browserTestCloudProfile=join(tmpdir(),`alpha-browser-cloud-test-${randomUUID()}`);
const development={
  // The development server explicitly opts into test mocks, fixtures and device controls.
  command: `npm run dev:ui -- --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 180_000,
  env: { ELIZA_DEV_ALLOW_TEST_MOCKS: '1', ALPHA_BROWSER_CLOUD_PROFILE: browserTestCloudProfile },
};
const production={
  // A flag-off production build served by vite preview: no mocks, fixtures or developer surfaces.
  // It is written outside web-dist so it never replaces a release or test-mocks build.
  command: `npm run upstream:prepare-client && npx vite build --outDir ../../test-results/production-web && node scripts/audit-production-bundle.mjs test-results/production-web && npx vite preview --outDir ../../test-results/production-web --host 127.0.0.1 --port ${productionPort} --strictPort`,
  url: `http://127.0.0.1:${productionPort}`, reuseExistingServer: false, timeout: 180_000,
  env: { ELIZA_DEV_ALLOW_TEST_MOCKS: '', VITE_ELIZA_DEV_ALLOW_TEST_MOCKS: '', VITE_LOCAL_AGENT: '' },
};

export default defineConfig({
  testDir: './test/browser',
  // Loads the app once on the development server before the workers start (see the file).
  globalSetup: needsDevelopment ? './test/browser/warm-dev-server.ts' : undefined,
  timeout: 30_000,
  workers: 2,
  fullyParallel: true,
  reporter: [['list'], ['html', { outputFolder: 'test-results/browser-report', open: 'never' }]],
  outputDir: 'test-results/browser',
  // Motion stays at the browser default: many specs measure transitions and settled geometry.
  // `reducedMotion` is not a Playwright test option (a bare `use.reducedMotion` is ignored);
  // a spec that needs it opts in with test.use({contextOptions:{reducedMotion:'reduce'}}).
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 412, height: 915 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', testIgnore: productionSpec },
    { name: 'production', testMatch: productionSpec, use: { baseURL: `http://127.0.0.1:${productionPort}` } },
    { name: 'firefox', testMatch: storageSpecPattern, use: { ...devices['Desktop Firefox'], baseURL: `http://127.0.0.1:${port}`, viewport: { width: 412, height: 915 } } },
    { name: 'webkit', testMatch: storageSpecPattern, use: { ...devices['Desktop Safari'], baseURL: `http://127.0.0.1:${port}`, viewport: { width: 412, height: 915 } } },
  ],
  webServer: [...(needsDevelopment?[development]:[]),...(needsProduction?[production]:[])],
});
