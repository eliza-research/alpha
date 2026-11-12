import assert from 'node:assert/strict';
import test from 'node:test';
import {AutomaticInstallHistoryError, readAutomaticInstallHistory} from '../scripts/wireless-install-history.ts';

const expected = {packageName: 'ai.alphacompute.alphaphone', appId: '10123', versionCode: 8,
  apkSha256: 'a'.repeat(64), signerRootSha256: 'b'.repeat(64)};
const referrer = `alpha-update://${expected.packageName}/${expected.versionCode}/${expected.apkSha256}/${expected.signerRootSha256}/3/intent`;
const evidence = {sessionId: 763, userId: 0, requireUserAction: 'NOT_REQUIRED',
  permissionsManuallyAccepted: false, finalStatus: 1};

// Android 14 serializes the whole session through an inner 4-space writer.
// Android 17 renders metadata directly and prints the pre-serialized params.
function session({id = evidence.sessionId, api = 37, wrapped = true, user = 0, uid = expected.appId, originalUid = uid,
  installer = expected.packageName, original = installer, initiator = installer, app = expected.packageName,
  binding = referrer + '/automatic', mode = 'NOT_REQUIRED', approved = 'false', committed = 'true', status = '1'} = {}) {
  const identity = [
    `userId=${user}`, `mOriginalInstallerUid=${originalUid}`, `mOriginalInstallerPackageName=${original}`,
    `installerPackageName=${installer}`, `installInitiatingPackageName=${initiator}`,
    'installOriginatingPackageName=null', `mInstallerUid=${uid}`, 'createdMillis=1000', 'updatedMillis=3000',
    'committedMillis=2000', `stageDir=/data/app/vmdl${id}.tmp`, 'stageCid=null',
  ];
  const params = [
    'mode=1', 'installFlags=0x12', 'installLocation=0', 'installReason=0', 'installScenario=0', 'sizeBytes=12',
    `appPackageName=${app}`, 'appIcon=false', 'appLabel=null', 'originatingUri=null', 'originatingUid=-1',
    `referrerUri=${binding}`, 'abiOverride=null', 'volumeUuid=null', 'packageSource=0', 'installerPackageName=null',
    'isMultiPackage=false', 'isStaged=false', 'forceQueryable=false', `requireUserAction=${mode}`,
  ];
  const state = [
    'mClientProgress=1.0', 'mProgress=1.0', `mCommitted=${committed}`, 'mPreapprovalRequested=false', 'mSealed=true',
    ...(approved == null ? [] : [`mPermissionsManuallyAccepted=${approved}`]), 'mStageDirInUse=false',
    'mDestroyed=true', 'mFds=0', 'mBridges=0', `mFinalStatus=${status}`, 'mFinalMessage=Session installed',
  ];
  function wrap(fields) {
    const indent = api === 34 ? '  ' : '    ';
    const line = (api === 34 ? '    ' : '') + fields.join(' ') + ' ';
    if (!wrapped) return [indent + line];
    return (line.match(new RegExp(`.{1,${120 - indent.length}}`, 'g')) ?? []).map(chunk => indent + chunk);
  }
  return [`  Session ${id}:`, ...[identity, params, state].flatMap(wrap)].join('\n') + '\n';
}

function history(...entries) {
  return ['Active install sessions:', session({id: 42}), 'Historical install sessions:',
    ...entries, 'Legacy install sessions:', '  []', 'Silent update policy:'].join('\n');
}

function refuses(dump, code) {
  assert.throws(() => readAutomaticInstallHistory(dump, expected),
    error => error instanceof AutomaticInstallHistoryError && error.code === code && !error.message.includes('alpha-update://'));
}

test('AOSP 14 and 17 wrapped histories bind the unattended result to the installed APK', () => {
  for (const api of [34, 37]) {
    const actual = readAutomaticInstallHistory(history(session({api})), expected);
    assert.deepEqual(actual, evidence);
    assert.doesNotMatch(JSON.stringify(actual), /alpha-update:|appLabel|referrer|boot|10123/);
  }
  assert.deepEqual(readAutomaticInstallHistory(history(session({id: 101, status: '-115', committed: 'false'}),
    session({id: 102, status: '0', committed: 'false'}), session()).replaceAll('\n', '\r\n'), expected), evidence);
  assert.deepEqual(readAutomaticInstallHistory(history(session({wrapped: false})), expected), evidence);
});

test('automatic mode requires both the exact binding and the Android mode without approval', () => {
  refuses(history(session({binding: referrer, mode: 'UNSPECIFIED'})), 'manual-mode');
  refuses(history(session({binding: referrer})), 'manual-mode');
  refuses(history(session({mode: 'REQUIRED'})), 'manual-mode');
  refuses(history(session({approved: 'true'})), 'manual-approval');
});

test('history cannot use another successful session, forged attribution or an active record', () => {
  refuses(history(session(), session({id: 764})), 'ambiguous');
  refuses(history(session(), session({id: 764, binding: referrer, mode: 'UNSPECIFIED'})), 'ambiguous');
  refuses(history(session({uid: '10124'})), 'attribution-mismatch');
  refuses(history(session({originalUid: '10124'})), 'attribution-mismatch');
  refuses(history(session({original: 'com.android.shell'})), 'attribution-mismatch');
  refuses(history(session({installer: 'com.android.shell', original: expected.packageName})), 'attribution-mismatch');
  refuses(history(session({initiator: 'com.android.shell'})), 'attribution-mismatch');
  refuses(history(session({app: 'com.android.shell'})), 'attribution-mismatch');
  refuses(history(session({user: 1})), 'attribution-mismatch');
  refuses(history(session({binding: referrer.replace(expected.apkSha256, 'c'.repeat(64)) + '/automatic'})), 'not-found');
  refuses(history(session({binding: referrer.replace(expected.signerRootSha256, 'c'.repeat(64)) + '/automatic'})), 'not-found');
  refuses(history(session({binding: referrer.replace('/8/', '/9/') + '/automatic'})), 'not-found');
  refuses(history(), 'not-found');
});

test('absent, incomplete, oversized or inconsistent history cannot certify an unattended update', () => {
  refuses('', 'unsupported');
  refuses('Historical install sessions:\n' + session(), 'unsupported');
  refuses(history(session({approved: null})), 'unsupported');
  refuses(history(session({committed: 'false'})), 'unsupported');
  refuses(history(session({mode: 'unknown'})), 'unsupported');
  refuses(history(session() + '    mPermissionsManuallyAccepted=true\n'), 'unsupported');
  refuses(history(session({status: '-115'})), 'not-found');
  refuses(' '.repeat(8 * 1024 * 1024 + 1), 'unsupported');
});
