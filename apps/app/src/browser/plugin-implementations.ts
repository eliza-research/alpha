import {BrowserDeletions} from './deletions';
// Registers AlphaConnection with its browser factory (HTTPS fetch, connection-slot secrets, Cloud sign-in tab).
import '../runtime/native-connection';
import './register-hosted-results';
import {BrowserClock} from './clock';
import { BrowserLocation } from './location';
import { BrowserVoice } from './voice';
import { BrowserMailAttachments } from './mail-attachments';
import { BrowserFiles } from './files';
import { BrowserDevice } from './device';
import { BrowserDaily } from './daily';
import { BrowserNotifications } from './notifications';
import { BrowserCalendar } from './calendar';
import { BrowserSurface } from './browser-surface';
export function createBrowserPlugins() {
  const location = new BrowserLocation();
  const device = new BrowserDevice();
  const voice = new BrowserVoice();
  const files = new BrowserFiles();
  const daily = new BrowserDaily(files);
  const calendar=new BrowserCalendar();
  const notifications=new BrowserNotifications(daily,calendar);
  new BrowserClock(daily,notifications);
  // One instance: Capacitor's lazy loader calls the factory once per concurrent
  // first call, which would split listeners from the surface that emits events.
  const browserSurface = new BrowserSurface();
  return {
    ElizaLocation: location, AlphaDevice: device, ElizaSystem: device,
    AlphaVoiceCloud: voice, AlphaNoteAudio: voice, AlphaFiles: files,
    AlphaMailAttachments: new BrowserMailAttachments(files), DailyApps: daily,
    AlphaDeletions: new BrowserDeletions(daily, calendar),
    AlphaNotifications: notifications, AlphaCalendar: calendar, AlphaBrowser: browserSurface,
  };
}
