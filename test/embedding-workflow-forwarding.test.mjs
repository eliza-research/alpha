import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const workflow=fs.readFileSync(new URL('../.github/workflows/resident-android.yml',import.meta.url),'utf8');
const match=workflow.match(/      - name: Stage and archive qualified resident runtime\n[\s\S]*?        run: \|\n([\s\S]*?)(?=      - name:)/);
assert.ok(match);
const body=match[1].split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
function calls(enabled){
 const shell=`set -e
python3(){ printf 'python3'; printf '|%s' "$@"; printf '\\n'; }
node(){ printf 'node'; printf '|%s' "$@"; printf '\\n'; }
bun(){ printf '1.4.2\\n'; }
${body}`;
 const result=spawnSync('/bin/bash',['-c',shell],{encoding:'utf8',timeout:5000,env:{...process.env,ALPHA_RUNTIME_PROFILE:'cloud',ALPHA_LOCAL_EMBEDDINGS:enabled?'1':'0',ALPHA_LOCAL_AGENT_SOURCE_DIR:'/prepared',GITHUB_WORKSPACE:'/workspace'}});
 assert.equal(result.status,0,result.stderr);
 return result.stdout.trim().split('\n').map(line=>line.split('|'));
}
test('requested capability reaches stage, qualified receipt mapping and archive',()=>{
 const rows=calls(true),stage=rows.find(row=>row.includes('runtime-stage')),archive=rows.find(row=>row.includes('cloud-archive')),qualification=rows.find(row=>row.includes('embedding-stage'));
 assert.ok(stage.includes('--runtime-profile=cloud')&&stage.includes('--local-embeddings'));
 assert.ok(archive.includes('--runtime-profile=cloud')&&archive.includes('--local-embeddings'));
 assert.ok(qualification.includes('--receipt')&&qualification.includes('--library-root'));
 assert.ok(qualification.includes('/workspace/test-results/resident-ci/embedding-inputs/component'));
});
test('ordinary Cloud flow does not stage local libraries or request embedding capability',()=>{
 const rows=calls(false);assert.ok(!rows.some(row=>row.includes('embedding-stage')));
 assert.ok(!rows.some(row=>row.includes('--local-embeddings')));
 assert.ok(rows.some(row=>row.includes('cloud-archive')));
});

test('artifact acquisition follows supervisor proof and precedes product installation',()=>{
 const proof=workflow.indexOf('name: Qualify supervisor on real Linux processes');
 const acquisition=workflow.indexOf('name: Acquire exact compiled component and semantic qualification');
 const install=workflow.indexOf('--name product-install');
 assert.ok(proof>=0&&proof<acquisition&&acquisition<install);
});

function jobCondition(name,event,operation,profile='native',mode='off'){
 const block=workflow.split('\n  '+name+':\n')[1].split(/\n  [a-z][a-z-]*:\n/)[0];
 const multiline=block.match(/    if: >-\n((?:      [^\n]*\n)+)/);
 const single=block.match(/    if: ([^\n]+)\n/);
 const expression=(multiline?multiline[1]:single[1]).trim().replaceAll('github.event_name','event').replaceAll('inputs.operation','operation').replaceAll('inputs.runtime_profile','profile').replaceAll('vars.ELIZA_RESIDENT_QUALIFICATION','mode');
 return new Function('event','operation','profile','mode','return '+expression)(event,operation,profile,mode);
}
test('registered upload-only mode cannot run APK or native jobs',()=>{
 for(const profile of ['native','cloud']){
  assert.equal(jobCondition('publish-qualification','workflow_dispatch','publish-qualification',profile),true);
  for(const job of ['build','native','recovery-ui'])assert.equal(jobCondition(job,'workflow_dispatch','publish-qualification',profile),false);
 }
 assert.equal(jobCondition('build','workflow_dispatch','build','cloud'),true);
 assert.equal(jobCondition('build','workflow_dispatch','','cloud'),true);
 assert.equal(jobCondition('build','workflow_dispatch','unknown','native'),false);
 assert.equal(jobCondition('native','push',null,'native'),true);
 assert.equal(jobCondition('recovery-ui','schedule',null,'native'),true);
 assert.ok(workflow.includes('uses: ./.github/workflows/embedding-qualification-carrier.yml'));
 assert.ok(workflow.includes("inputs.operation == 'publish-qualification' && '-carrier'"));
});
