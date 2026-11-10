// A stubbed Capacitor bridge in the Alpha image shape with synthetic calls, voicemail, conversations
// and contacts. No device, SIM, carrier, Telecom or provider is involved: a call "placed" or a message
// "sent" here is recorded at the bridge and proves nothing about a radio.
import {expect, type Page} from '@playwright/test';

export type TelephonyFixture = {
  /** Access already granted (the default); false starts every read at its Allow button. */
  granted?: boolean;
  /** `direct` lets the reviewed send run; `handoff` is a phone without the SMS role. */
  sendMode?: 'direct' | 'handoff';
  voicemail?: 'ready' | 'unconfigured' | 'unsupported';
  empty?: boolean;
};

export async function setupTelephony(page: Page, options: TelephonyFixture = {}) {
  await page.addInitScript((options: TelephonyFixture) => {
    localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind: 'offline'}));
    const w = window as any;
    w.androidBridge = {};
    w.telephonyCalls = [];
    w.telephonyInputs = [];
    const granted = options.granted !== false, direct = options.sendMode !== 'handoff';
    w.access = {callLog: granted, sms: granted, contacts: granted};
    const now = Date.now(), minute = 60_000, hour = 60 * minute, day = 24 * hour;
    const people = options.empty ? [] : [
      {id: '11', name: 'Ada Okafor', phones: ['+15550100101'], emails: ['ada@example.invalid']},
      {id: '12', name: 'Bao Tran', phones: ['+15550100102', '+15550100112'], emails: []},
      {id: '13', name: 'Carmen Ruiz', phones: ['+15550100103'], emails: ['carmen@example.invalid']},
      {id: '14', name: 'Dev Patel', phones: ['+15550100104'], emails: []},
      {id: '15', name: 'Elif Demir', phones: ['+15550100105'], emails: []},
      {id: '16', name: 'Farid Haddad', phones: ['+15550100106'], emails: []},
      {id: '17', name: 'Grace Lindqvist', phones: ['+15550100107'], emails: ['grace@example.invalid']},
      {id: '18', name: 'Hana Sato', phones: ['+15550100108'], emails: []},
    ];
    w.people = people;
    const version = (id: string) => id.padStart(64, 'a');
    const calls = options.empty ? [] : [
      {id: '1', number: '+15550100101', cachedName: 'Ada Okafor', date: now - 12 * minute, durationSeconds: 0, type: 'missed', isNew: true},
      {id: '2', number: '+15550100103', cachedName: 'Carmen Ruiz', date: now - 2 * hour, durationSeconds: 312, type: 'outgoing', isNew: false},
      {id: '3', number: '+15550100199', cachedName: null, date: now - 5 * hour, durationSeconds: 48, type: 'incoming', isNew: false},
      {id: '4', number: '+15550100102', cachedName: 'Bao Tran', date: now - day - hour, durationSeconds: 0, type: 'missed', isNew: false},
      {id: '5', number: '', cachedName: null, date: now - day - 3 * hour, durationSeconds: 0, type: 'rejected', isNew: false},
      {id: '6', number: '+15550100104', cachedName: 'Dev Patel', date: now - 2 * day, durationSeconds: 95, type: 'incoming', isNew: false},
      {id: '7', number: '+15550100107', cachedName: 'Grace Lindqvist', date: now - 3 * day, durationSeconds: 1260, type: 'outgoing', isNew: false},
      {id: '8', number: '+15550100105', cachedName: 'Elif Demir', date: now - 6 * day, durationSeconds: 20, type: 'incoming', isNew: false},
    ];
    w.voicemails = options.empty ? [] : [
      {id: '31', number: '+15550100101', cachedName: 'Ada Okafor', date: now - 10 * minute, durationSeconds: 24, isNew: true, hasAudio: true, carrierTranscript: 'Hi, it is Ada. The keys are with the neighbour at number four. Call me when you land.'},
      {id: '32', number: '+15550100199', cachedName: null, date: now - 26 * hour, durationSeconds: 41, isNew: true, hasAudio: true, carrierTranscript: null},
      {id: '33', number: '+15550100104', cachedName: 'Dev Patel', date: now - 4 * day, durationSeconds: 12, isNew: false, hasAudio: true, carrierTranscript: 'Dev here. Lunch on Thursday still works for me.'},
    ];
    const message = (id: number, threadId: string, incoming: boolean, ago: number, body: string, address: string) => ({
      id: `sms:${id}`, kind: 'sms', threadId, direction: incoming ? 'incoming' : 'outgoing', status: incoming ? 'read' : 'sent', date: now - ago, read: true,
      subscriptionId: 1, addresses: [address], body, deliveryReport: incoming ? null : 'none', attachments: 0,
    });
    w.messages = options.empty ? {} : {
      'thread:101': [
        message(1, 'thread:101', true, 3 * hour, 'Are we still on for dinner on Friday?', '+15550100101'),
        message(2, 'thread:101', false, 3 * hour - 4 * minute, 'Yes. Seven at the usual place?', '+15550100101'),
        message(3, 'thread:101', true, 2 * hour, 'Perfect. I will book the table.', '+15550100101'),
        message(4, 'thread:101', true, 9 * minute, 'Running ten minutes late, sorry. Can you order for me?', '+15550100101'),
      ],
      'thread:102': [
        message(5, 'thread:102', false, day, 'Did the parcel arrive?', '+15550100102'),
        message(6, 'thread:102', true, day - hour, 'It did. Thank you!', '+15550100102'),
      ],
      'thread:103': [message(7, 'thread:103', true, 2 * day, 'Your code is 000000. It expires in ten minutes.', '+15550100198')],
      'thread:104': [message(8, 'thread:104', true, 3 * day, 'Can you send me the address for Saturday?', '+15550100103'), message(9, 'thread:104', false, 3 * day - hour, 'Twelve Example Lane. See you there.', '+15550100103')],
      'thread:105': [message(10, 'thread:105', true, 5 * day, 'Happy birthday!', '+15550100107')],
    };
    const threads = () => Object.entries(w.messages as Record<string, any[]>).map(([id, rows]) => {
      const last = rows[rows.length - 1];
      return {id, date: last.date, messageCount: rows.length, snippet: last.body, unread: id === 'thread:101' || id === 'thread:103' ? !w.readThreads?.includes(id) : false, addresses: last.addresses};
    }).sort((a, b) => b.date - a.date);
    const status = () => ({
      version: 2, voiceCapable: true, smsCapable: true,
      permissions: {contacts: w.access.contacts ? 'granted' : 'prompt', phoneState: 'granted', sms: w.access.sms ? 'granted' : 'prompt', sendSms: direct && w.access.sms ? 'granted' : 'prompt', callLog: w.access.callLog ? 'granted' : 'prompt'},
      sendMode: direct && w.access.sms ? 'direct' : 'handoff', mmsSend: false,
      roles: {dialer: {available: true, held: true, eligible: true}, sms: {available: true, held: direct, eligible: true}},
      defaultDialer: 'ai.alphacompute.alphaphone', defaultSms: direct ? 'ai.alphacompute.alphaphone' : 'com.android.messaging',
      subscriptions: [{id: 1, slot: 0, displayName: 'Synthetic SIM', carrierName: 'Synthetic Carrier', defaultSms: true, defaultVoice: true}], defaultSmsSubscriptionId: 1,
    });
    const wav = () => {
      const seconds = 2, length = seconds * 16000 * 2, bytes = new Uint8Array(44 + length), view = new DataView(bytes.buffer);
      bytes.set([82, 73, 70, 70]); view.setUint32(4, 36 + length, true); bytes.set([87, 65, 86, 69, 102, 109, 116, 32], 8);
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); bytes.set([100, 97, 116, 97], 36); view.setUint32(40, length, true);
      let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return {mimeType: 'audio/wav', sampleRateHz: 16000, durationSeconds: seconds, data: btoa(binary)};
    };
    const names = ['AlphaContacts', 'DailyApps', 'AlphaBrowser', 'AlphaConnection', 'AlphaDevice', 'AlphaLocalAgent', 'AlphaHostedResults', 'AlphaVoiceCloud', 'AlphaNotifications', 'ElizaSystem', 'AlphaCalendar', 'AlphaNoteDocuments', 'AlphaNoteAudio', 'AlphaFiles', 'AlphaPhotos', 'DeviceApps', 'ElizaLocation', 'AlphaActionJournal', 'AlphaTelephony'];
    const methods = ['addListener', 'removeListener', 'surfaceInfo', 'readPending', 'readPendingResult', 'readDelegationCallback', 'readSecret', 'secureRead', 'secureWrite', 'secureRemove', 'get', 'save', 'remove', 'status', 'getStatus', 'getState', 'state', 'permissionState', 'permissions', 'list', 'listCalendars', 'listEvents', 'listReminders', 'listBookmarks', 'getBookmarks', 'bookmarks', 'settings', 'getSettings', 'buildInfo', 'platformCapabilities', 'capabilities', 'query', 'read', 'readJournal', 'getPending', 'readSelection', 'requestPermissions', 'create', 'edit',
      'imageCapability', 'requestAccess', 'requestRole', 'searchContacts', 'listRecentCalls', 'dial', 'placeCall', 'composeSms', 'listThreads', 'listMessages', 'observeMessages', 'markThreadRead', 'sendSms', 'cancelSmsReview', 'smsSendHistory', 'smsSendResult',
      'voicemailStatus', 'listVoicemail', 'fetchVoicemailAudio', 'voicemailAudio', 'voicemailPcm', 'markVoicemailHeard', 'deleteVoicemail', 'observeVoicemail', 'callState', 'answerCall', 'endCall', 'setCallAudio', 'observeCalls', 'sendCallTone'];
    w.Capacitor = {Plugins: {}, PluginHeaders: names.map(name => ({name, methods: methods.map(name => ({name, rtype: name === 'addListener' ? 'callback' : 'promise'}))})), nativeCallback: () => 'fixture-callback', nativePromise: async (plugin: string, method: string, input: any) => {
      if (plugin === 'AlphaTelephony') {
        w.telephonyCalls.push(method); w.telephonyInputs.push([method, input]);
        if (w.telephonyAnswers?.[method]) return w.telephonyAnswers[method](input);
        if (method === 'imageCapability') return {version: 1, image: true, feature: 'fixture.image'};
        if (method === 'status') return status();
        if (method === 'requestAccess') { w.access[input.access === 'callLog' ? 'callLog' : input.access] = true; if (input.access === 'sendSms') w.access.sms = true; return status(); }
        if (method === 'searchContacts') { const query = String(input.query || '').toLowerCase(); return {contacts: people.filter(p => !query || p.name.toLowerCase().includes(query) || p.phones.some(n => n.includes(query))).slice(0, input.limit).map(p => ({id: p.id, lookupKey: `lookup-${p.id}`, displayName: p.name, phoneNumbers: p.phones, emailAddresses: p.emails, starred: false}))}; }
        if (method === 'listRecentCalls') return {calls};
        if (method === 'placeCall') return {status: 'placed', message: ''};
        if (method === 'dial') return {status: 'handed-off', target: 'dialer', handler: 'com.android.dialer', message: 'Your phone app is open with the number.'};
        if (method === 'voicemailStatus') return {access: true, state: options.voicemail || 'ready'};
        if (method === 'listVoicemail') return {state: options.voicemail || 'ready', voicemails: (options.voicemail || 'ready') === 'ready' ? w.voicemails : []};
        if (method === 'fetchVoicemailAudio') return {status: 'ready'};
        if (method === 'voicemailPcm') return wav();
        if (method === 'markVoicemailHeard') return {status: 'marked'};
        if (method === 'deleteVoicemail') { w.voicemails = w.voicemails.filter((row: any) => row.id !== input.id); return {status: 'deleted'}; }
        if (method === 'listThreads') return {threads: w.access.sms ? threads() : [], next: null};
        if (method === 'listMessages') return {messages: [...(w.messages[input.threadId] || [])].reverse().slice(0, input.limit), next: null};
        if (method === 'markThreadRead') { w.readThreads = [...(w.readThreads || []), input.threadId]; return {status: 'marked'}; }
        if (method === 'smsSendHistory') return {records: []};
        if (method === 'callState') return w.callState || {calls: []};
        return {};
      }
      if (plugin === 'AlphaContacts') {
        w.telephonyInputs.push([`contacts.${method}`, input]);
        if (method === 'requestPermissions') w.access.contacts = true;
        if (['status', 'requestPermissions'].includes(method)) return {available: true, readable: w.access.contacts, writable: w.access.contacts};
        if (method === 'list') { const query = String(input?.query || '').toLowerCase(); return {contacts: people.filter(p => !query || p.name.toLowerCase().includes(query)).map(p => ({id: p.id, lookup: `lookup-${p.id}`, revision: '1', name: p.name, phones: p.phones, emails: p.emails})), more: false}; }
        if (method === 'get') { const p = people.find(row => row.id === input.id); if (!p) throw Error('missing'); return {id: p.id, lookup: `lookup-${p.id}`, displayName: p.name, starred: false, phoneNumbers: p.phones.map(number => ({value: number, type: 'mobile'})), emailAddresses: p.emails.map(address => ({value: address, type: 'home'})), version: version(p.id)}; }
        if (method === 'save') { if (w.contactAnswers?.save) return w.contactAnswers.save(input); return {status: 'saved', id: input.id || '99', version: version('9')}; }
        if (method === 'remove') return {status: 'removed'};
      }
      if (method === 'surfaceInfo') return {topInset: 0, bottomInset: 0}; if (method === 'buildInfo') return {launcher: false};
      if (method === 'platformCapabilities') return {aospImage: true, contacts: true, phone: true, sms: true};
      if (['secureRead', 'readSecret'].includes(method)) return {value: null};
      return {apps: [], events: [], calendars: [], reminders: [], bookmarks: [], results: [], items: [], entries: [], pending: [], capabilities: [], available: false};
    }};
  }, options);
  await page.goto('/');
  await expect(page.getByRole('button', {name: 'Notes', exact: true})).toBeVisible();
}
