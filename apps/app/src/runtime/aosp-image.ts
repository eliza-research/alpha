import { Capacitor } from '@capacitor/core';
import { detectTelephonyProfile, TELEPHONY_PROFILE_METHOD } from '../../../../.eliza/client-features/packages/contracts/src/native-telephony.ts';
/**
 * Alpha AOSP image capability (owner decision P-36, issue #420).
 *
 * Phone, Contacts and SMS exist only on the Alpha AOSP image. The capability is decided by native
 * code from facts an ordinary install cannot produce (see AlphaImageCapability.java): the launcher
 * build preinstalled on a system partition, with the product provisioning overlay and the image's system feature, in a release
 * build without test mocks. MainActivity registers the `AlphaTelephony` plugin only then, so the renderer reads the
 * answer from the plugin headers Capacitor injects before any page script runs. Nothing here reads a
 * URL, storage, a build flag or the launcher flavor: a standalone APK, a sideloaded launcher APK, a
 * browser and a test-mocks development server all read `false`, and restored state cannot change it.
 */
export const AOSP_TELEPHONY_PLUGIN = 'AlphaTelephony';
/** The native method whose presence marks the verified capability (the shared telephony profile marker). */
export const AOSP_IMAGE_METHOD = TELEPHONY_PROFILE_METHOD;
/** Views the owner decision limits to the Alpha AOSP image. */
export const AOSP_IMAGE_VIEWS: readonly string[] = Object.freeze(['phone', 'messages', 'contacts']);
/**
 * SMS has a native provider and reviewed-send adapter. Phone has the shared profile's bounded
 * recent-calls read and dial handoff (prototype/phone-adapter.ts); it never places or simulates a
 * call. Contacts has its own bounded native adapter and is admitted dynamically by
 * DeviceApps.platformCapabilities before mounting. All of them need the verified image first.
 */
export const ADMITTED_AOSP_VIEW_ADAPTERS: readonly string[] = Object.freeze(['messages', 'phone']);

/** True only for an Android bridge whose native side registered the image-only plugin. */
export function detectAospImage(platform: string, headers: unknown): boolean {
  return detectTelephonyProfile(platform, headers, AOSP_TELEPHONY_PLUGIN);
}
/** Views available in this install: an image view needs both the image and an admitted adapter. */
export function admittedAospViews(image: boolean, admitted: readonly string[] = ADMITTED_AOSP_VIEW_ADAPTERS): string[] {
  return image ? admitted.filter(view => AOSP_IMAGE_VIEWS.includes(view)) : [];
}

const capacitor = Capacitor as typeof Capacitor & { PluginHeaders?: unknown };
/** Read once at module load; the native registration cannot change while the page lives. */
export const aospImage: boolean = detectAospImage(Capacitor.getPlatform(), capacitor.PluginHeaders);
