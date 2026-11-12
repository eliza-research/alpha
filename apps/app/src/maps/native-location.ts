import { NativeMapsLocation as SharedLocation, type LocationBridge } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/native-location.ts';
import { registerPlugin } from '../platform-plugins';
import { Capacitor } from '@capacitor/core';
export type { Position } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/location.ts';
const location = registerPlugin<LocationBridge>('ElizaLocation');
export class NativeMapsLocation extends SharedLocation {
 constructor() { super(location, { isNative: () => Capacitor.isNativePlatform(), available: () => Capacitor.isPluginAvailable('ElizaLocation') }); }
}
/** Whether location is already granted, without showing a permission prompt. */
export async function locationPermissionGranted(): Promise<boolean> {
 if (Capacitor.isNativePlatform() && !Capacitor.isPluginAvailable('ElizaLocation')) return false;
 try { return (await location.checkPermissions()).location === 'granted'; } catch { return false; }
}
