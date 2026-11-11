import {bookmarkDocument,alertSoundDocument,passwordProviderDocument,albumDocument,devicePreferencesDocument,deviceRolesDocument} from './preference-documents';
import {openDomainRecovery} from './domain-recovery';
export function openBookmarkRecovery(){openDomainRecovery(bookmarkDocument,'bookmarks','Browser bookmark recovery','Download, then reset.');}
export function openAlertSoundRecovery(){openDomainRecovery(alertSoundDocument,'alert sound history','Notification sound recovery','Download, then reset.');}

export function openPasswordProviderRecovery(){openDomainRecovery(passwordProviderDocument,'password provider','Development password provider recovery','Download provider settings before resetting. Reset removes the development provider selection and installation state. The older copy remains available for backup. Close older Alpha tabs before continuing.');}

export function openAlbumRecovery(){openDomainRecovery(albumDocument,'photo albums','Photo album recovery','Download, then reset.');}

export function openDevicePreferencesRecovery(){openDomainRecovery(devicePreferencesDocument,'device settings','Device settings recovery','Download saved settings before resetting. Reset restores browser display, volume and network defaults and enables microphone/location controls. Browser permissions are still required. The older copy remains available for backup. Close older Alpha tabs before continuing.');}
export function openDeviceRolesRecovery(){openDomainRecovery(deviceRolesDocument,'device roles','Device role recovery','Download saved role selections before resetting. Reset clears simulated role selections. The older copy remains available for backup. Close older Alpha tabs before continuing.');}
