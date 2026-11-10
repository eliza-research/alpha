import { SavedPlaces as SharedSavedPlaces } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/saved-places.ts';
import { isGoogleMapsProvider } from './cloud-provider';
import { MapsFailure } from './contracts';
export type { SavedPlace } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/saved-places.ts';
/** Preserve the installed Alpha Phone data namespace. */
export class SavedPlaces extends SharedSavedPlaces {
 constructor(
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
  private readonly isGoogleProvider: (providerId: string) => boolean = isGoogleMapsProvider,
 ) { super('alpha.maps.saved-places.v1', storage); }

 override save(input: Parameters<SharedSavedPlaces['save']>[0]) {
  // The shared store persists provider labels and coordinates without expiry.
  if (input.providerId && this.isGoogleProvider(input.providerId))
   throw new MapsFailure('unsupported', 'Google Maps results cannot be saved on this device.');
  return super.save(input);
 }
}
