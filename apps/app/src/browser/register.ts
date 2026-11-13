import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '../platform-plugins';

// Establish every proxy before implementation imports can request a plugin.
if (!Capacitor.isNativePlatform()) {
  const plugins = import('./plugin-implementations').then(module => module.createBrowserPlugins());
  for (const name of [
    'ElizaLocation', 'AlphaDevice', 'ElizaSystem', 'AlphaVoiceCloud', 'AlphaNoteAudio',
    'AlphaFiles', 'AlphaMailAttachments', 'DailyApps', 'AlphaDeletions',
    'AlphaNotifications', 'AlphaCalendar', 'AlphaBrowser',
  ] as const) {
    registerPlugin(name, { web: () => plugins.then(implementations => implementations[name]) });
  }
}
