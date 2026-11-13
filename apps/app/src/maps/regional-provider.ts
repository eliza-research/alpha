import { createRegionalMaps, type RegionalOptions } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/regional-provider.ts';
import { Capacitor } from '@capacitor/core';
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
// (ELIZA_DEV_ALLOW_TEST_MOCKS=1) read VITE_MAPS_BASE_URL, and the plain-HTTP loopback host
// folds out of every other build. Product builds use Eliza Cloud Maps (./cloud-maps.ts).
// Android has no native regional transport: there the gateway is reached by fetch only and
// must use HTTPS, so the native gateway is empty and the transport refuses.
const regionalBaseUrl: string | undefined = testMocksEnabled ? import.meta.env.VITE_MAPS_BASE_URL || undefined : undefined;
export const regionalMapsConfigured = !!regionalBaseUrl;
const noNativeTransport: RegionalOptions['transport'] = {
 request: async () => { throw new Error('Regional Maps has no native transport.'); },
 cancel: async () => {},
};
export const { regionalDiagnostics, nativeRegion, nativeRegionRequest, regionalMap, initializeRegionalMaps } = createRegionalMaps({
 baseUrl: regionalBaseUrl,
 nativeGateway: '',
 developmentHosts: testMocksEnabled ? ['127.0.0.1'] : [],
 development: devSurfacesEnabled,
 isNative: () => Capacitor.isNativePlatform(),
 developmentBuild: async () => false,
 transport: noNativeTransport,
 configure: configureMapsProvider,
});
