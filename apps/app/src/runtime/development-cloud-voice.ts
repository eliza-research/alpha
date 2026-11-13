import {browserCloudResidentEnabled} from './browser-cloud-resident';
import {Capacitor} from '@capacitor/core';
/** Batch speech through the explicit real Cloud resident (bun run dev:cloud). The paired agent owns
 * Cloud credentials; the page never does. */
export const developmentCloudVoiceEnabled=browserCloudResidentEnabled;

/** Canonical realtime conversation uses Cloud speech while the agent remains on this Mac. */
export const developmentCloudRealtimeVoiceEnabled=import.meta.env!==undefined&&import.meta.env.DEV===true&&(browserCloudResidentEnabled||import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS==='1')&&!Capacitor.isNativePlatform()&&import.meta.env.VITE_ALPHA_DEV_CLOUD_REALTIME_VOICE==='1';
