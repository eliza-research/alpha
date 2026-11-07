import {Capacitor} from '@capacitor/core';
import {devSurfacesEnabled,privateLocalPreviewEnabled} from '../build-flags';
export const developmentCartesiaVoiceEnabled=import.meta.env.DEV===true&&(devSurfacesEnabled||privateLocalPreviewEnabled)&&!Capacitor.isNativePlatform()&&import.meta.env.VITE_ALPHA_DEV_CARTESIA==='1';
