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
