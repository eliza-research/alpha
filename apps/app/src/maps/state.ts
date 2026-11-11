import { MapsController as SharedMapsController } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/state.ts';
import type { MapsProvider, ProviderConfig } from './contracts';
import { NativeMapsLocation } from './native-location';
import { SavedPlaces } from './saved-places';
import { isGoogleMapsProvider, isLocalMapsPlace } from './cloud-provider';
export type { MapsState } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/state.ts';
/** Compose the shared controller with this installation's storage and device bridge. */
export class MapsController extends SharedMapsController {
 private originProviderId?: string;
 constructor(config: ProviderConfig = { status: 'unconfigured' }, provider?: MapsProvider, savedPlaces = new SavedPlaces(), location = new NativeMapsLocation(), private readonly isGoogleProvider: (id: string) => boolean = isGoogleMapsProvider) {
  super(config, provider, savedPlaces, location);
 }
 override chooseOrigin(candidate: Parameters<SharedMapsController['chooseOrigin']>[0]) {
  const config = this.snapshot().provider;
  if ('label' in candidate && !isLocalMapsPlace(
   {origin:'saved', providerId:candidate.providerId}, config.status === 'configured' ? config.providerId : undefined, this.isGoogleProvider,
  )) {
   this.clearOrigin();
   return this.planRoute();
  }
  const pending = super.chooseOrigin(candidate);
  this.originProviderId = candidate.providerId;
  return pending;
 }
 override setOrigin(...args: Parameters<SharedMapsController['setOrigin']>) {
  super.setOrigin(...args);
  this.originProviderId = undefined;
 }
 override clearOrigin() {
  super.clearOrigin();
  this.originProviderId = undefined;
 }
 override activateProvider(config: ProviderConfig, provider?: MapsProvider) {
  if (this.originProviderId && (config.status !== 'configured' || config.providerId !== this.originProviderId)) this.clearOrigin();
  super.activateProvider(config, provider);
 }
}
