import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {checkIndicatorProvider,indicatorProviderScenarios,probeIndicatorProvider} from '../specs/quint/refinement/native/indicator-provider.mjs';
import {preparePatchedNative} from '../scripts/prepare-patched-native.ts';

test('actual SystemUI lease provider preserves generation/death ownership and restores caller identity', {timeout:360000},async()=>{
 const result=await checkIndicatorProvider(['test/quint-indicator-provider.test.mjs']);
 assert.equal(result.passed,true);
 assert.equal(result.traces,indicatorProviderScenarios.length);
 assert.equal(result.driverInputsBound,true);
 assert.equal(result.inputsUnchanged,true);
 assert.ok(result.actions.failedCall>0);
 assert.ok(result.actions.binderDeath>0);
});

test('two held-monitor acquire calls retain the current generation death recipient', {timeout:60000},()=>{
 const result=probeIndicatorProvider();
 assert.equal(result.attempts,32);
 assert.equal(result.mismatches,0);
 assert.equal(result.unrestoredIdentities,0);
});

test('both host distributions select the shared patched listener source set',()=>{
 const staged=preparePatchedNative();
 const module='packages/app/platforms/android/sense';
 const descriptor=readFileSync('android/sense/build.gradle','utf8');
 assert.ok(staged.modules.includes(module));
 assert.match(descriptor,/commandLine 'bun', 'scripts\/prepare-patched-native\.ts'/);
 assert.match(descriptor,/ext\.elizaSenseSourceDir = new File\(preparedSense\.root\.toString\(\), 'packages\/app\/platforms\/android\/sense'\)/);
 assert.match(descriptor,/apply from: new File\(elizaSenseSourceDir, 'consumer.gradle'\)/);
 const profile=JSON.parse(readFileSync('android/consumer-host.json','utf8')).profile;
 assert.deepEqual(profile.flavors.map(row=>row.name),['standalone','launcher']);
 assert.equal(profile.modules.find(row=>row.name==='sense').source.path,'android/sense');
 const consumer=readFileSync(join(staged.root,module,'consumer.gradle'),'utf8');
 assert.match(consumer,/sourceSets\.main\s*\{\s*java\.srcDirs = \[new File\(source, 'src\/main\/java'\)/);
 assert.match(consumer,/buildTypes\s*\{[\s\S]*debug\s*\{[\s\S]*release\s*\{/);
 const provider=readFileSync(join(staged.root,module,'src/main/java/ai/eliza/sense/IndicatorLeaseProvider.java'),'utf8');
 assert.match(provider,/synchronized\(IndicatorLeaseProvider\.class\)\{\s*\/\/[^\n]+\n\s*generation=Listener\.lease\.acquire\(boot\);/);
});
