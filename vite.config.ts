import {checkCloudDeployment} from './scripts/cloud-deployment.mjs';
import {browserCloudDevBridge} from './scripts/browser-cloud-dev-bridge.ts';
import {localOcrAssets} from './scripts/local-ocr-assets.ts';
import { browserPdfAssets } from './scripts/browser-pdf-assets.ts';
import { browserFullReload } from './scripts/browser-full-reload.ts';
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { localAgentDevBridge } from './scripts/local-agent-dev-bridge.ts';

// One switch, upstream name (vendor/eliza/packages/app/scripts/dev-ui.ts): "1" opts
// test-only mocks, fixtures and developer surfaces into a build. Anything else is off.
// Only this single key is exposed; envPrefix stays VITE_ so ELIZA_* secrets never reach the bundle.
checkCloudDeployment(fileURLToPath(new URL('.', import.meta.url)));
const flagOn = process.env.ELIZA_DEV_ALLOW_TEST_MOCKS === '1' || process.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS === '1';
const appConfig = JSON.parse(readFileSync(fileURLToPath(new URL('./app.config.json', import.meta.url)), 'utf8')) as { version?: unknown };
const appVersion = process.env.ELIZAOS_VERSION_NAME?.trim() || (typeof appConfig.version === 'string' ? appConfig.version : '0.0.0');
const prototypeDirectory = fileURLToPath(new URL('./apps/app/src/prototype/', import.meta.url));
const fixturesModule = path.join(prototypeDirectory, 'fixtures.js');
const emptyFixturesModule = path.join(prototypeDirectory, 'fixtures.empty.js');

// Developer and mock modules that main.tsx, the connection UI and the password manager import behind the flag.
// Flag-off builds resolve them to inert stubs with the same export names, so neither the
// modules nor an orphan chunk ship. Their call sites are constant-folded away and never run.
const disabledModuleSource: Record<string, string> = {
  './browser/device-controls': 'export const BrowserDeviceControls = null;',
  './browser/simulated-apps': 'export const captureSimulatedApps = () => undefined; export const installSimulatedApps = () => {};',
  // Only imported dynamically, after a constant-false guard, so an empty module suffices.
  './runtime/mock-admission': 'export {};',
  './mock-admission': 'export {};',
  // Development password vault, statically imported by passwords/password-manager.ts.
  './dev-vault': 'export const createDevelopmentVault = () => { throw new Error("unavailable"); };',
};
const disabledModulePrefix = '\0alpha-disabled-';
const srcDirectory = fileURLToPath(new URL('./apps/app/src/', import.meta.url));

/** Production CSP. Dev serve stays relaxed for HMR and the local agent bridge. */
export function productionContentSecurityPolicy(testMocks: boolean): string {
  const connect = ["'self'", 'https:', ...(testMocks ? ['http://10.0.2.2:*', 'http://127.0.0.1:*', 'http://localhost:*'] : [])];
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    `connect-src ${connect.join(' ')}`,
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "frame-src 'self' blob: data: https:",
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/** Build-only CSP meta, build-flag record and fixture swap for flag-off builds. */
function productionSurface(): Plugin[] {
  return [
    {
      name: 'alpha-test-mock-fixtures',
      enforce: 'pre',
      async resolveId(source, importer, options) {
        if (flagOn || !/(^|\/)fixtures(\.js)?$/.test(source)) return null;
        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
        if (!resolved || resolved.external) return null;
        const id = resolved.id.split('?')[0];
        // Tolerates a tree where the fixture module has not been extracted yet.
        if (path.resolve(id) !== fixturesModule || !existsSync(emptyFixturesModule)) return null;
        return emptyFixturesModule;
      },
    },
    {
      name: 'alpha-test-mock-modules',
      enforce: 'pre',
      resolveId(source, importer) {
        if (flagOn || !importer || !Object.hasOwn(disabledModuleSource, source)) return null;
        const owner = path.relative(srcDirectory, importer.split('?')[0]).split(path.sep).join('/');
        if (owner !== 'main.tsx' && owner !== 'runtime/connection-ui.tsx' && owner !== 'passwords/password-manager.ts') return null;
        // The virtual id carries an index, not the source name, so no chunk is named after it.
        return disabledModulePrefix + Object.keys(disabledModuleSource).indexOf(source);
      },
      load(id) { return id.startsWith(disabledModulePrefix) ? Object.values(disabledModuleSource)[Number(id.slice(disabledModulePrefix.length))] ?? null : null; },
    },
    {
      name: 'alpha-production-csp',
      apply: 'build',
      transformIndexHtml: {
        order: 'pre',
        handler: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: productionContentSecurityPolicy(flagOn) }, injectTo: 'head-prepend' }],
      },
    },
    {
      name: 'alpha-build-flags',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'build-flags.json', source: JSON.stringify({ testMocks: flagOn, ...(process.env.VITE_ELIZA_RUNTIME_PROFILE === 'cloud' ? {runtimeProfile:'cloud'} : {}) }) + '\n' });
      },
    },
  ];
}

export default defineConfig({
  root: "apps/app",
  plugins: [productionSurface(), localOcrAssets(), browserPdfAssets(), browserFullReload(), react(), localAgentDevBridge(), browserCloudDevBridge()],
  define: {
    'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS': JSON.stringify(flagOn ? '1' : ''),
    __APP_VERSION__: JSON.stringify(appVersion),
    'import.meta.env.VITE_ALPHA_DEV_CARTESIA':JSON.stringify(flagOn&&process.env.ALPHA_DEV_CARTESIA==='1'?'1':''),
  },
  // Module workers (the MapLibre worker). The web build has no speech worker or in-browser
  // inference runtime: local speech runs on the local agent's native libelizainference.
  worker: { format: 'es' },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      "@elizaos/capacitor-system/sense": fileURLToPath(new URL("./.eliza/client-features/plugins/plugin-native-system/src/sense-bridge.ts", import.meta.url)),
      "@elizaos/capacitor-system/reset": fileURLToPath(new URL("./.eliza/client-features/plugins/plugin-native-system/src/reset.ts", import.meta.url)),
      "@elizaos/capacitor-system/settings": fileURLToPath(new URL("./.eliza/client-features/plugins/plugin-native-system/src/settings.ts", import.meta.url)),
      "@elizaos/contracts/stated-clock-time": fileURLToPath(new URL("./.eliza/client-features/packages/contracts/src/stated-clock-time.ts", import.meta.url)),
      "@elizaos/contracts/browser-request-grounding": fileURLToPath(new URL("./.eliza/client-features/packages/contracts/src/browser-request-grounding.ts", import.meta.url)),
      "@elizaos/contracts/phone-dial": fileURLToPath(new URL("./.eliza/client-features/packages/contracts/src/phone-dial.ts", import.meta.url)),
      "@elizaos/contracts/device-action-execution": fileURLToPath(new URL("./.eliza/client-features/packages/contracts/src/device-action-execution.ts", import.meta.url)),
      "@elizaos/ui/view-primitives": fileURLToPath(new URL("./.eliza/client-features/packages/ui/src/view-primitives.ts",import.meta.url)),
      "@elizaos/capacitor-system/shade": fileURLToPath(new URL("./.eliza/client-features/plugins/plugin-native-system/src/client/shade.ts",import.meta.url)),
      "@elizaos/capacitor-system/launcher": fileURLToPath(new URL("./.eliza/client-features/plugins/plugin-native-system/src/client/launcher.ts",import.meta.url)),
      // The core entry precedes the shell entry: an alias also matches its own subpaths.
      "@elizaos/ui/mobile-shell/core": fileURLToPath(new URL("./.eliza/client-features/packages/ui/src/mobile-shell/core.ts",import.meta.url)),
      "@elizaos/ui/mobile-shell": fileURLToPath(new URL("./.eliza/client-features/packages/ui/src/mobile-shell/index.ts",import.meta.url)),
      "@elizaos/ui/voice/voice-session-client": fileURLToPath(new URL("./.eliza/client-features/packages/ui/src/voice/voice-session-client-core.ts",import.meta.url)),
      "@elizaos/host/voice/ui-context": fileURLToPath(new URL("./.eliza/client-features/packages/host/src/voice/ui-context.ts",import.meta.url)),
      "@elizaos/core/read-memo": fileURLToPath(new URL("./.eliza/client-features/packages/core/src/read-memo.ts",import.meta.url)),
      "@elizaos/core/logging": fileURLToPath(new URL("./.eliza/client-features/packages/core/src/logging.ts",import.meta.url)),
      "@elizaos/core/view-interaction": fileURLToPath(new URL("./.eliza/client-features/packages/core/src/view-interaction.ts",import.meta.url)),
      "@elizaos/core/protocol": fileURLToPath(new URL("./.eliza/client-features/alpha-voice-core-protocol.ts",import.meta.url)),
      "@elizaos/voice/turn": fileURLToPath(new URL("./.eliza/client-features/packages/voice/src/turn.ts",import.meta.url)),
      "@elizaos/core/speech": fileURLToPath(new URL("./.eliza/client-features/packages/core/src/speech.ts",import.meta.url)),
      "@elizaos/ui/voice/batch-conversation": fileURLToPath(new URL("./.eliza/client-features/packages/ui/src/voice/batch-conversation.ts",import.meta.url)),
      "@elizaos/ui/accessibility/screen-focus": fileURLToPath(new URL("./.eliza/client-features/packages/ui/src/accessibility/screen-focus.ts",import.meta.url)),
      "@elizaos/ui/voice/voice-chat-playback": fileURLToPath(new URL("./.eliza/client-features/packages/ui/src/voice/voice-chat-playback.ts",import.meta.url)),
      "@elizaos/cloud-sdk/subscription-entitlement": fileURLToPath(new URL("./.eliza/client-features/packages/cloud/sdk/src/subscription-entitlement.ts",import.meta.url)),
      "@elizaos/contracts/deletion-window": fileURLToPath(new URL("./.eliza/client-features/packages/contracts/src/deletion-window.ts",import.meta.url)),
      "@elizaos/contracts/sms-send": fileURLToPath(new URL("./.eliza/client-features/packages/contracts/src/sms-send.ts",import.meta.url)),
      "@elizaos/contracts/native-notes-query": fileURLToPath(new URL("./.eliza/client-features/packages/contracts/src/native-notes-query.ts",import.meta.url)),
      "@elizaos/contracts": fileURLToPath(new URL("./.eliza/client-features/client-contracts.ts",import.meta.url)),
      "@elizaos/plugin-assistant/device-calendar-contract": fileURLToPath(new URL("./.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/calendar-contract.ts",import.meta.url)),
      "@elizaos/plugin-assistant/device-foreground-review": fileURLToPath(new URL("./.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/foreground-review-contract.ts",import.meta.url)),
      "@eliza-system": fileURLToPath(
        new URL(
          "./vendor/eliza/plugins/plugin-native-system/src/index.ts",
          import.meta.url,
        ),
      ),
    },
  },
  build: { outDir: "../../web-dist", emptyOutDir: true, sourcemap: false },
  server: { fs: { allow: [
    fileURLToPath(new URL('./apps/app', import.meta.url)),
    // Vite emits worklet URLs using real paths when this prepared tree is shared by a worktree.
    realpathSync(fileURLToPath(new URL('./.eliza/client-features', import.meta.url))),
    fileURLToPath(new URL('./.eliza/patched', import.meta.url)),
    fileURLToPath(new URL('./node_modules', import.meta.url)),
    fileURLToPath(new URL('./config/owner-routes.json', import.meta.url)),
    fileURLToPath(new URL('./config/alpha-product.json', import.meta.url)),
    fileURLToPath(new URL('./vendor/eliza/plugins/plugin-native-system', import.meta.url)),
    fileURLToPath(new URL('./vendor/eliza/plugins/plugin-assistant/src/services/device-actions', import.meta.url)),
  ] } },
});
