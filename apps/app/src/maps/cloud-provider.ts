import type { ProviderConfig } from './contracts';
import type { CloudMapsCoverage } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/cloud-provider.ts';
export * from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/cloud-provider.ts';

const defaultGoogleProvider = 'eliza-cloud-google';

/** Cloud deployments may override the provider ID, but Google coverage identifies its data source. */
export function isGoogleMapsCoverage(coverage?: CloudMapsCoverage): boolean {
 return !!coverage && (coverage.providerId === defaultGoogleProvider || coverage.sources?.data === 'Google Maps');
}

export function isGoogleMapsProvider(providerId?: string, coverage?: CloudMapsCoverage): boolean {
 return providerId === defaultGoogleProvider || (providerId !== undefined && providerId === coverage?.providerId && isGoogleMapsCoverage(coverage));
}

/** Provider-backed saved rows need a verified source before they can use local map/share flows. */
export function isLocalMapsPlace(
 place: {origin: 'manual' | 'location' | 'saved' | 'provider'; providerId?: string} | undefined,
 verifiedProviderId?: string,
 isGoogleProvider: (providerId: string) => boolean = isGoogleMapsProvider,
 live?: {controller: ProviderConfig; connection: ProviderConfig},
): boolean {
 if (!place) return false;
 if (place.origin === 'manual' || place.origin === 'location' || !place.providerId) return true;
 const liveProviderId = place.origin === 'provider' && live?.controller.status === 'configured'
  && live.connection.status === 'configured' && live.controller.providerId === live.connection.providerId
  ? live.controller.providerId : undefined;
 return place.providerId === (verifiedProviderId || liveProviderId) && !isGoogleProvider(place.providerId);
}
