import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const workflow=fs.readFileSync(new URL('../.github/workflows/resident-android.yml',import.meta.url),'utf8');
const bodies=['Stage and archive qualified resident runtime','Archive the isolated test-mocks build'].map(name=>{
 const match=workflow.match(new RegExp('      - name: '+name+'\\n[\\s\\S]*?        run: \\|\\n([\\s\\S]*?)(?=      - name:)'));
 assert.ok(match);
 return match[1].split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
});
function calls(extra={}){
 const shell=`set -e
python3(){ printf 'python3'; printf '|%s' "$@"; printf '|GRADLE_OPTS=%s\\n' "\${GRADLE_OPTS-}"; }
node(){ printf 'node'; printf '|%s' "$@"; printf '\\n'; }
bun(){ printf '1.4.2\\n'; }
${bodies.join('\n')}`;
 const result=spawnSync('/bin/bash',['-c',shell],{encoding:'utf8',timeout:5000,env:{...process.env,GRADLE_OPTS:'',ALPHA_LOCAL_AGENT_SOURCE_DIR:'/prepared',GITHUB_WORKSPACE:'/workspace',...extra}});
 assert.equal(result.status,0,result.stderr);
 return result.stdout.trim().split('\n').map(line=>line.split('|'));
}
// One runtime profile: the workflow stages and archives one resident, with local speech and
// embeddings always packaged. No dispatch input or environment selects a profile or a capability.
test('the single lane stages once and archives the distribution and test-mocks builds, with no profile or capability option',()=>{
 for(const inherited of [{},{ALPHA_RUNTIME_PROFILE:'cloud',ALPHA_LOCAL_EMBEDDINGS:'1'}]){
  const rows=calls(inherited),stage=rows.filter(row=>row.includes('runtime-stage'));
  assert.equal(stage.length,1);assert.deepEqual(stage[0].slice(stage[0].indexOf('bun')),['bun','run','agent:stage-android','GRADLE_OPTS=']);
  const archives=rows.filter(row=>row.includes('scripts/build-archive.ts'));
  assert.deepEqual(archives.map(row=>row.slice(row.indexOf('scripts/build-archive.ts')+1,-1)),[['test-results/resident-ci-distribution'],['--test-mocks','test-results/resident-ci-archive']]);
  assert.ok(!rows.some(row=>row.some(cell=>/--runtime-profile|--local-embeddings|embedding-stage|cloud-archive|resident-ci-cloud/.test(cell))));
 }
});
test('the workflow offers no runtime profile or local-embeddings input and no Cloud-only step',()=>{
 assert.doesNotMatch(workflow,/runtime_profile|local_embeddings|ALPHA_RUNTIME_PROFILE|ALPHA_LOCAL_EMBEDDINGS|--runtime-profile|--local-embeddings|--verify-cloud|resident-cloud-archive|resident-ci-cloud/);
 assert.match(workflow,/ELIZA_ANDROID_BUN_TARGET: linux-musl\n      ELIZA_ANDROID_TARGET_ABIS: arm64-v8a,x86_64\n/);
 // The protected signing input is the flag-off distribution archive with its producer evidence.
 assert.match(workflow,/name: resident-distribution-archive-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_id \}\}\n          path: test-results\/resident-ci-distribution\/\n/);
 assert.match(fs.readFileSync(new URL('../scripts/ci/verify-cloud-signing-input.sh',import.meta.url),'utf8'),/\.name == \("resident-distribution-archive-" \+ \$source \+ "-" \+ \$run\)/);
 assert.match(workflow,/out = root \/ 'test-results\/resident-ci-distribution\/producer-evidence'/);
 assert.match(workflow,/'runtimeProfile': 'native', 'updateChannel': channel, 'versionCode'/);
 assert.match(workflow,/bun scripts\/runtime-profile\.ts --verify-native\n/);
});

function jobCondition(name,event,operation,mode='off'){
 const block=workflow.split('\n  '+name+':\n')[1].split(/\n  [a-z][a-z-]*:\n/)[0];
 const multiline=block.match(/    if: >-\n((?:      [^\n]*\n)+)/);
 const single=block.match(/    if: ([^\n]+)\n/);
 const expression=(multiline?multiline[1]:single[1]).trim().replaceAll('github.event_name','event').replaceAll('inputs.operation','operation').replaceAll('vars.ELIZA_RESIDENT_QUALIFICATION','mode');
 return new Function('event','operation','mode','return '+expression)(event,operation,mode);
}
test('registered upload-only mode cannot run APK or native jobs',()=>{
 assert.equal(jobCondition('publish-qualification','workflow_dispatch','publish-qualification'),true);
 for(const job of ['build','native','recovery-ui'])assert.equal(jobCondition(job,'workflow_dispatch','publish-qualification'),false);
 assert.equal(jobCondition('build','workflow_dispatch','build'),true);
 assert.equal(jobCondition('build','workflow_dispatch',''),true);
 assert.equal(jobCondition('build','workflow_dispatch','unknown'),false);
 // Every dispatched build runs the native qualification jobs: there is no Cloud lane to skip them.
 for(const job of ['native','recovery-ui'])assert.equal(jobCondition(job,'workflow_dispatch','build'),true);
 assert.equal(jobCondition('native','push',null),true);
 assert.equal(jobCondition('recovery-ui','schedule',null),true);
 assert.ok(workflow.includes('uses: ./.github/workflows/embedding-qualification-carrier.yml'));
 assert.ok(workflow.includes("inputs.operation == 'publish-qualification' && '-carrier'"));
});
