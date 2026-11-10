/** Product storage identities and installed ciphertext format over the shared codec. */
import { runNativeFixture } from "./native-test-fixture.ts";

const [appApk, testApk, output] = process.argv.slice(2);
if (!appApk || !testApk || !output)
  throw new Error("Provide an archived app APK, matching instrumentation APK and new evidence directory");
await runNativeFixture({
  scenario: "browser-storage-format",
  appApk,
  testApk,
  output,
  testClass: "BrowserStorageFormatInstrumentedTest",
  testMethod: "installedBrowserRecordsKeepTheirFormat",
  runnerArgs: ["-e", "disposableBrowserStorageFixture", "1"],
  requireWebView: false,
  evidence: "Real Keystore and product bookmark, session and site-permission storage; deployed format read/write compatibility in a fresh emulator user. No website or physical-device acceptance.",
});
