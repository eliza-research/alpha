import type {StartupPermissionBridge, StartupPermissionKey} from './startup-permission-flow';
type BrowserPorts = {
  permissions?: Pick<Permissions, 'query'>;
  media?: Pick<MediaDevices, 'getUserMedia'>;
  geolocation?: Pick<Geolocation, 'getCurrentPosition'>;
  notifications?: Pick<typeof Notification, 'permission' | 'requestPermission'>;
};
/** Permission-only user gestures. Media tracks are immediately stopped; location coordinates are discarded. */
export function browserStartupPermission(key: StartupPermissionKey, ports: BrowserPorts): StartupPermissionBridge {
  let freshGrant = false;
  let requested = false;
  let denied = false;
  const supported = () => key === 'notifications' ? !!ports.notifications?.requestPermission
    : key === 'location' ? !!ports.geolocation?.getCurrentPosition : !!ports.media?.getUserMedia;
  return {
    async status() {
      if (!supported()) throw Error('Permission API unavailable');
      if (key === 'notifications') {
        const state = ports.notifications!.permission;
        if (!['granted', 'denied', 'default'].includes(state)) throw Error('Notification status unavailable');
        return {granted: state === 'granted', enabled: state === 'granted', requestable: state !== 'denied'};
      }
      let state: PermissionState;
      try {
        const name = (key === 'location' ? 'geolocation' : key) as PermissionName;
        if (!ports.permissions) throw Error('Permission query unavailable');
        state = (await ports.permissions.query({name})).state;
      } catch {
        // A successful explicit request proves this readback only. Never retain it as a later grant.
        const granted = freshGrant; freshGrant = false;
        if (denied) return {granted: false, enabled: false, requestable: false};
        if (!granted && requested) throw Error('Permission status unavailable');
        return {granted, enabled: granted, requestable: true};
      }
      if (!['granted', 'denied', 'prompt'].includes(state)) throw Error('Permission status unavailable');
      freshGrant = false;
      if (state === 'granted') denied = false;
      return {granted: state === 'granted', enabled: state === 'granted', requestable: state !== 'denied' && !denied};
    },
    async request() {
      if (!supported()) throw Error('Permission API unavailable');
      requested = true;
      if (key === 'notifications') {
        // Some embedded browsers leave this promise pending without showing a prompt.
        // Bound the UI wait only: the browser still owns permission and late completion.
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            ports.notifications!.requestPermission(),
            new Promise<void>(resolve => {timer = setTimeout(resolve, 15000);}),
          ]);
        } finally {clearTimeout(timer);}
        return;
      }
      if (key === 'location') {
        try {
          await new Promise<void>((resolve, reject) => ports.geolocation!.getCurrentPosition(
            () => {freshGrant = true; resolve();}, reject,
            {enableHighAccuracy: false, maximumAge: 0, timeout: 10000},
          ));
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 1) {denied = true; freshGrant = false; return;}
          if (error && typeof error === 'object' && 'code' in error && (error.code === 2 || error.code === 3)) {
            // Permission setup does not require a GPS fix. Maps owns fix errors/retry;
            // finish this request only when the browser itself confirms permission.
            try { if ((await ports.permissions?.query({name: 'geolocation'}))?.state === 'granted') return; }
            catch { /* Unknown permission authority retains the original failure. */ }
          }
          throw error;
        }
        return;
      }
      let stream: MediaStream;
      try { stream = await ports.media!.getUserMedia(key === 'camera' ? {video: true, audio: false} : {audio: true, video: false}); }
      catch (error) {
        if (error && typeof error === 'object' && 'name' in error && error.name === 'NotAllowedError') {denied = true; freshGrant = false; return;}
        throw error;
      }
      const tracks=stream.getTracks();
      const live=tracks.length>0 && tracks.every(track=>track.readyState !== 'ended');
      let failed = false;
      for (const track of tracks) { try { track.stop(); } catch { failed = true; } }
      if (failed) throw Error('Media permission cleanup unavailable');
      if (!live) throw Error('Live media permission could not be confirmed');
      freshGrant = true;
    },
    async openSettings() { throw Error('Use address bar'); },
  };
}
