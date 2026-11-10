import path from 'node:path';
import { resolveAndroidSdkRoot, resolveJavaHome, javaMajorVersion } from '../vendor/eliza/packages/app/scripts/mobile/toolchain.ts';

export function androidEnv() {
  const sdk = resolveAndroidSdkRoot();
  const java = resolveJavaHome();
  if (!sdk) throw new Error('Set ANDROID_HOME to an installed Android SDK (platform 36).');
  if (!java || (javaMajorVersion(java) ?? 0) < 21) throw new Error('Install JDK 21 or set JAVA_HOME to JDK 21.');
  return { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, JAVA_HOME: java };
}
export function tool(name: string) {
  return path.join(androidEnv().ANDROID_HOME, 'build-tools', '36.0.0', name);
}
