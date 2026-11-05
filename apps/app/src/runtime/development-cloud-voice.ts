import {browserCloudResidentEnabled} from './browser-cloud-resident';
import {Capacitor} from '@capacitor/core';
/** Explicit real resident or Mac preview. The paired agent owns Cloud credentials; the page never does.
 * The environment guard also keeps Node-only protocol consumers inert. */
export const developmentCloudVoiceEnabled=browserCloudResidentEnabled||(import.meta.env!==undefined&&import.meta.env.DEV===true&&import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS==='1'&&!Capacitor.isNativePlatform()&&import.meta.env.VITE_ALPHA_DEV_CLOUD_VOICE==='1');

/** Canonical realtime conversation uses Cloud speech while the agent remains on this Mac. */
export const developmentCloudRealtimeVoiceEnabled=import.meta.env!==undefined&&import.meta.env.DEV===true&&(browserCloudResidentEnabled||import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS==='1')&&!Capacitor.isNativePlatform()&&import.meta.env.VITE_ALPHA_DEV_CLOUD_REALTIME_VOICE==='1';
