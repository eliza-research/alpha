import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importedModelPaths,proofPhases,selectChangedModels} from '../scripts/ci/check-changed-models.mjs';

const a={module:'A',family:'application',path:'specs/quint/application/A.qnt',sources:['apps/app/src/a.ts']};
const b={module:'B',family:'native',path:'specs/quint/native/B.qnt',sources:['vendor/eliza/plugins/maps/b.ts']};
test('changed model and consumed source both select their owning proof',()=>{
 assert.deepEqual(selectChangedModels([a,b],[a.path]),[a]);
 assert.deepEqual(selectChangedModels([a,b],['apps/app/src/a.ts']),[a]);
 assert.deepEqual(selectChangedModels([a,b],['upstream.lock.json']),[b]);
 assert.deepEqual(selectChangedModels([a,b],['unrelated.txt']),[]);
});
test('a manifest edit selects changed/new entries without skipping source ownership',()=>{
 const previous=new Map([['A',a],['B',b]]);
 assert.deepEqual(selectChangedModels([a,b],['specs/quint/application/manifest.json'],previous),[]);
 const changed={...a,invariant:'RepairedSafety'};
 assert.deepEqual(selectChangedModels([changed,b],['specs/quint/application/manifest.json'],previous),[changed]);
 assert.deepEqual(selectChangedModels([a,b],['specs/quint/application/manifest.json'],new Map()),[a]);
});
test('checker changes require every proof and known counterexamples remain required phases',()=>{
 assert.deepEqual(selectChangedModels([a,b],['scripts/check-quint.mjs']),[a,b]);
 assert.deepEqual(proofPhases(a),['verify']);
 assert.deepEqual(proofPhases({...a,temporal:['EventuallyReady'],expectedViolations:[{invariant:'HistoricalBug'}]}),['verify','temporal','compare']);
 assert.deepEqual(proofPhases({...a,currentTemporalChecks:[{property:'OldLiveness'}]}),['verify','compare']);
});
test('a changed imported model selects every transitive composition owner',()=>{
 const c={module:'C',family:'native',path:'specs/quint/native/C.qnt',sources:[]};
 const dependencies=new Map([[b.path,[a.path]],[c.path,[b.path]]]);
 assert.deepEqual(selectChangedModels([a,b,c],[a.path],new Map(),dependencies),[a,b,c]);
 assert.deepEqual(importedModelPaths(c,'module C {\n import A(\n instance=1\n ) as A1 from "../application/A"\n import B.* from "./B"\n}'),[a.path,b.path]);
});
