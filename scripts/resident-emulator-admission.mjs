/** Read-only admission before credentials, user creation or APK installation. */
export function admitResidentEmulator(environment, adb) {
  if (environment.ALPHA_RESIDENT_DISPOSABLE_EMULATOR !== '1' ||
      !/^emulator-\d+$/.test(environment.ANDROID_SERIAL || '')) {
    throw Error('Explicit disposable emulator selection required');
  }
  if (adb(['shell', 'getprop', 'ro.kernel.qemu']).trim() !== '1' ||
      adb(['shell', 'getprop', 'ro.product.cpu.abi']).trim() !== 'arm64-v8a') {
    throw Error('Resident provider fixture requires an ARM64 emulator');
  }
  const packages = adb(['shell', 'pm', 'list', 'packages', '-u']).trim().split(/\r?\n/).filter(Boolean);
  if (!packages.length || packages.some(row => !/^package:[\w.]+$/.test(row)) ||
      packages.some(row => /^package:ai\.alphacompute\.alphaphone(?:\.test)?$/.test(row))) {
    throw Error('Use a fresh emulator without an existing Alpha Phone installation');
  }
}

/** Remove only the user created by this run, and require completed removal. */
export function removeResidentFixtureUser(adb, user, name) {
  if (!/^[1-9]\d*$/.test(user) || !/^alpha-resident-[a-f0-9-]{36}$/.test(name)) throw Error('Invalid fixture ownership');
  const inventory = () => [...adb(['shell', 'pm', 'list', 'users']).matchAll(/UserInfo\{(\d+):([^:}]+):[^}]+\}/g)];
  const before = inventory();
  if (!before.some(row => row[1] === '0') || before.filter(row => row[1] === user).length !== 1 ||
      before.find(row => row[1] === user)?.[2] !== name) throw Error('Fixture ownership changed; preserve user');
  const foreground = adb(['shell', 'am', 'get-current-user']).trim();
  if (!/^\d+$/.test(foreground) || foreground === user) throw Error('Fixture foreground state changed; preserve user');
  if (!/^Success: removed user\s*$/.test(adb(['shell', 'pm', 'remove-user', user]).trim())) throw Error('Fixture removal unconfirmed');
  const after = inventory();
  if (!after.some(row => row[1] === '0') || after.some(row => row[1] === user)) throw Error('Fixture removal unconfirmed');
}
