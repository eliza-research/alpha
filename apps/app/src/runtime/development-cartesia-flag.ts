import {Capacitor} from '@capacitor/core';
import {devSurfacesEnabled} from '../build-flags';
export const developmentCartesiaVoiceEnabled=devSurfacesEnabled&&!Capacitor.isNativePlatform()&&import.meta.env.VITE_ALPHA_DEV_CARTESIA==='1';
