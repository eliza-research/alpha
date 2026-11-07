// Scratch config (not committed): production lane without upstream:prepare-client.
import base from './playwright.config';
const port=Number(process.env.ALPHA_BROWSER_TEST_PORT||5317)+1;
export default {...base,webServer:[{
 command:`npx vite build --outDir ../../test-results/production-web && node scripts/audit-production-bundle.mjs test-results/production-web && npx vite preview --outDir ../../test-results/production-web --host 127.0.0.1 --port ${port} --strictPort`,
 url:`http://127.0.0.1:${port}`,reuseExistingServer:false,timeout:300_000,
 env:{ELIZA_DEV_ALLOW_TEST_MOCKS:'',VITE_ELIZA_DEV_ALLOW_TEST_MOCKS:'',VITE_LOCAL_AGENT:''}}]};
