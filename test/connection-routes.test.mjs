import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeSource,fixture,runJvm,upstreamConnection} from './fixtures/jvm-tools.mjs';

// Plain-JVM compile and run of the native renderer-transport route policy. This does not build an
// APK, run on Android, or contact Eliza Cloud or any agent.
// The JDK is JAVA_HOME, else the Homebrew openjdk@21 on darwin when it is installed, else javac on PATH.
test('native transport refuses production pairing and non-Cloud origins and admits DELETE only for Cloud self-revocation',()=>{
 assert.match(runJvm([nativeSource('CloudDeployment.java'),upstreamConnection('CloudConnectionPolicy.java'),nativeSource('ConnectionRoutes.java'),fixture('ConnectionRoutesTest.java')],'ai.alphacompute.alphaphone.ConnectionRoutesTest'),/^PASS connection routes/);
});
