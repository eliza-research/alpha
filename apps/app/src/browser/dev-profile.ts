import { Capacitor } from '@capacitor/core';
// Same value as devSurfacesEnabled in build-flags.ts, spelled so Node contract
// tests that import device-actions -> mvp-features can load this module without Vite.
const devSurfacesEnabled:boolean=import.meta.env!==undefined&&import.meta.env.DEV===true&&import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS==='1';
/** Explicit local device simulator; never selected in an Android package or a
 * build without ELIZA_DEV_ALLOW_TEST_MOCKS=1 on the development server. */
export const browserDevProfile=devSurfacesEnabled&&!Capacitor.isNativePlatform()&&new URLSearchParams(location.search).get('mode')==='dev';

/** The one Developer gate for Settings: a development-server build opened with ?tools=1.
 * Never true in a product build or the demo APK, whatever the URL says. */
export const developerTools=devSurfacesEnabled&&new URLSearchParams(location.search).get('tools')==='1';

export const developmentAgentWorkflows=browserDevProfile&&new URLSearchParams(location.search).get('workflows')==='agent';
