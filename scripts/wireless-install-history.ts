/** Read the bounded PackageInstaller diagnostic history emitted by Android. */
type HistoryErrorCode = 'unsupported' | 'not-found' | 'ambiguous' |
  'manual-mode' | 'manual-approval' | 'attribution-mismatch';

const messages: Record<HistoryErrorCode, string> = {
  unsupported: 'Android install history is missing, incomplete or unsupported',
  'not-found': 'Android install history has no successful session for this exact update',
  ambiguous: 'Android install history has multiple successful sessions for this exact update',
  'manual-mode': 'Android install history reports a manual update mode',
  'manual-approval': 'Android install history reports manual approval',
  'attribution-mismatch': 'Android install history does not attribute the update to the primary-user Alpha installer',
};

export class AutomaticInstallHistoryError extends Error {
  readonly code: HistoryErrorCode;

  constructor(code: HistoryErrorCode) {
    super(messages[code]);
    this.name = 'AutomaticInstallHistoryError';
    this.code = code;
  }
}

type ExpectedInstall = {
  packageName: string;
  appId: string;
  versionCode: number;
  apkSha256: string;
  signerRootSha256: string;
};

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_DUMP_BYTES = 8 * 1024 * 1024;
const AOSP_WRAP_COLUMN = 120;

function unfoldSession(body: string) {
  let unfolded = '';
  let splitToken = false;
  // Android 14 saves the entire dump as text. Android 17 saves the params as
  // text. IndentingPrintWriter can split a long referrer across physical lines.
  const lines = body.split(/\r?\n/);
  const first = lines.find(line => /[^ \t]/.test(line));
  const indent = first?.startsWith('      userId=') ? '  ' : '    ';
  for (const line of lines) {
    if (/[^ \t]/.test(line)) {
      if (!line.startsWith(indent)) throw new AutomaticInstallHistoryError('unsupported');
      unfolded += (splitToken ? '' : ' ') + line.slice(indent.length).replace(/[ \t]+$/, '');
    }
    splitToken = line.length === AOSP_WRAP_COLUMN && !/[ \t]$/.test(line);
  }
  return unfolded.replace(/^[ \t]+/, '').replace(/[ \t]+/g, ' ');
}

export function readAutomaticInstallHistory(dump: string, expected: ExpectedInstall) {
  const {packageName, appId, versionCode, apkSha256, signerRootSha256} = expected;
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageName) || !/^[1-9]\d{0,4}$/.test(appId) ||
      !Number.isSafeInteger(versionCode) || versionCode < 1 || !SHA256.test(apkSha256) || !SHA256.test(signerRootSha256)) {
    throw new TypeError('Invalid expected install identity');
  }
  if (Buffer.byteLength(dump) > MAX_DUMP_BYTES) throw new AutomaticInstallHistoryError('unsupported');
  const start = /^Historical install sessions:[ \t]*\r?$/m.exec(dump);
  if (!start) throw new AutomaticInstallHistoryError('unsupported');
  const tail = dump.slice(start.index + start[0].length);
  const end = /^Legacy install sessions:[ \t]*\r?$/m.exec(tail);
  if (!end) throw new AutomaticInstallHistoryError('unsupported');
  const [preamble, ...entries] = tail.slice(0, end.index).split(/^  Session ([1-9]\d{0,9}):[ \t]*\r?$/m);
  if (preamble.trim()) throw new AutomaticInstallHistoryError('unsupported');

  const prefix = `alpha-update://${packageName}/${versionCode}/${apkSha256}/${signerRootSha256}/`;
  let match: {sessionId: number; automatic: boolean; approved: boolean} | undefined;
  for (let index = 0; index < entries.length; index += 2) {
    const body = unfoldSession(entries[index + 1]);
    const fields = (name: string) =>
      [...body.matchAll(new RegExp(`(?:^| )${name}=([^ ]+)`, 'g'))].map(([, value]) => value);
    const referrers = fields('referrerUri');
    const referrer = referrers.find(value => value.startsWith(prefix) &&
      /^\d{1,10}(?:\/intent(?:\/automatic)?)?$/.test(value.slice(prefix.length)));
    if (!referrer) continue;

    const one = (name: string) => {
      const values = fields(name);
      if (values.length !== 1) throw new AutomaticInstallHistoryError('unsupported');
      return values[0];
    };
    if (referrers.length !== 1) throw new AutomaticInstallHistoryError('unsupported');
    const status = one('mFinalStatus');
    if (!/^-?\d+$/.test(status)) throw new AutomaticInstallHistoryError('unsupported');
    // Known failed or abandoned attempts for the same bytes may precede success.
    if (status !== '1') continue;
    if (one('mCommitted') !== 'true' || one('mode') !== '1') throw new AutomaticInstallHistoryError('unsupported');
    const accepted = one('mPermissionsManuallyAccepted');
    const mode = one('requireUserAction');
    if (!['true', 'false'].includes(accepted) || !['NOT_REQUIRED', 'REQUIRED', 'UNSPECIFIED'].includes(mode)) {
      throw new AutomaticInstallHistoryError('unsupported');
    }

    // SessionParams prints a second installerPackageName. The authoritative
    // values are the leading PackageInstaller session identity, before params.
    const owner = /^userId=(\d+) mOriginalInstallerUid=(-?\d+) mOriginalInstallerPackageName=(\S+) installerPackageName=(\S+) installInitiatingPackageName=(\S+) installOriginatingPackageName=\S+ mInstallerUid=(-?\d+)(?: |$)/.exec(body);
    if (!owner) throw new AutomaticInstallHistoryError('unsupported');
    const [, user, originalUid, original, installer, initiator, uid] = owner;
    if (user !== '0' || originalUid !== appId || uid !== appId || original !== packageName ||
        installer !== packageName || initiator !== packageName || one('appPackageName') !== packageName) {
      throw new AutomaticInstallHistoryError('attribution-mismatch');
    }
    const sessionId = Number(entries[index]);
    if (sessionId > 0x7fffffff) throw new AutomaticInstallHistoryError('unsupported');
    if (match) throw new AutomaticInstallHistoryError('ambiguous');
    match = {sessionId, automatic: referrer.endsWith('/intent/automatic') && mode === 'NOT_REQUIRED',
      approved: accepted === 'true'};
  }

  if (!match) throw new AutomaticInstallHistoryError('not-found');
  if (!match.automatic) throw new AutomaticInstallHistoryError('manual-mode');
  if (match.approved) throw new AutomaticInstallHistoryError('manual-approval');
  return {
    sessionId: match.sessionId,
    userId: 0,
    requireUserAction: 'NOT_REQUIRED',
    permissionsManuallyAccepted: false,
    finalStatus: 1,
  } as const;
}
