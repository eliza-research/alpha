import { createRegionalMaps, type RegionalOptions } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/regional-provider.ts';
import { registerPlugin } from '../platform-plugins';
import { Capacitor } from '@capacitor/core';
import { DailyApps } from '../daily';
import { configureMapsProvider } from './runtime';
import { testMocksEnabled, devSurfacesEnabled } from '../build-flags';

/** Descriptor of the development dataset built by scripts/maps (the Monaco extract).
 * It is documentation and tooling data only: the configured gateway's /capabilities
 * supply the provider id and coverage bounds at runtime, so a build is not tied to it. */
export interface RegionalDataset {
 providerId: string;
 coverage: { region: string; bounds: readonly [number, number, number, number] };
}
export const regionalDataset: RegionalDataset = {
 providerId: 'alpha-osm-monaco',
 coverage: { region: 'Monaco', bounds: [7.409, 43.724, 7.449, 43.752] },
};

// The regional gateway is a development prototype (#412): only test-mocks builds
// (ELIZA_DEV_ALLOW_TEST_MOCKS=1) read VITE_MAPS_BASE_URL, and plain-HTTP loopback hosts
// and the emulator gateway fold out of every other build. Product builds use Eliza
// Cloud Maps (./cloud-maps.ts).
const regionalBaseUrl: string | undefined = testMocksEnabled ? import.meta.env.VITE_MAPS_BASE_URL || undefined : undefined;
export const regionalMapsConfigured = !!regionalBaseUrl;
export const { regionalDiagnostics, nativeRegion, nativeRegionRequest, regionalMap, initializeRegionalMaps } = createRegionalMaps({
 baseUrl: regionalBaseUrl,
 nativeGateway: testMocksEnabled ? 'http://10.0.2.2:47850' : '',
 developmentHosts: testMocksEnabled ? ['127.0.0.1', '10.0.2.2'] : [],
 development: devSurfacesEnabled,
 isNative: () => Capacitor.isNativePlatform(),
 developmentBuild: async () => testMocksEnabled && (await DailyApps.surfaceInfo()).developmentBuild === true,
 transport: registerPlugin<RegionalOptions['transport']>('AlphaMapsTransport'),
 configure: configureMapsProvider,
});
