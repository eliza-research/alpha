import {serviceInputs} from './source-inputs.mjs';
import assert from 'node:assert/strict';
import {normalizePhoneSpec} from '../../../../apps/app/src/runtime/phone-workflow-authoring.ts';
import {WorkflowClient} from '../../../../.eliza/client-features/packages/contracts/src/workflow-client.ts';
import {parsePhoneWorkflowSaveReceipt as parsePhoneReceipt} from '../../../../.eliza/client-features/packages/contracts/src/phone-workflow.ts';
import {workflowSha} from '../../../../apps/app/src/runtime/workflow-device-contract.ts';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {action, sourceModule} from './support.mjs';

export async function workflowRefinement(extraSources = []) {
  const sources = ['apps/app/src/runtime/phone-workflow-authoring.ts', 'apps/app/src/runtime/workflow-device-contract.ts', 'apps/app/src/runtime/workflow-intents.ts', '.eliza/client-features/packages/contracts/src/workflow-client.ts', '.eliza/client-features/packages/contracts/src/phone-workflow.ts', 'specs/quint/refinement/services/workflow.mjs', 'specs/quint/refinement/services/support.mjs'];
  const inputs = serviceInputs([...sources, ...extraSources]);
  const driverHashes = captureInputs(inputs);
  const client = new WorkflowClient(() => { throw Error('Unexpected network request'); }, {normalizePhoneSpec});
  const original = {window: globalThis.window, localStorage: globalThis.localStorage};
  const storage = Object.create(null);
  Object.defineProperties(storage, {getItem: {value: key => storage[key] ?? null}, setItem: {value: (key, value) => { storage[key] = String(value); }}, removeItem: {value: key => { delete storage[key]; }}});
  globalThis.window = new EventTarget(); globalThis.localStorage = storage;
  try {
    const {WorkflowIntentStore, workflowIntentKey} = await sourceModule('apps/app/src/runtime/workflow-intents.ts', {'@capacitor/core': 'export const Capacitor={getPlatform:()=>"android"};'});
    const owner = {origin: 'https://fixture.invalid', ownerId: 'owner-A', agentId: 'agent-A'};
    const store = new WorkflowIntentStore(owner), key = workflowIntentKey(owner, 'submission-A');
    await store.load();
    const spec = normalizePhoneSpec({version: 1, name: 'Fixture', description: '', trigger: {kind: 'manual'}, steps: [{id: 'input', kind: 'Read', operation: 'supplied_text', text: 'reviewed text'}]});
    const catalog = {catalogRevision: 'catalog-A', compilerRevision: 'compiler-A'};
    const validation = {spec, specDigest: await workflowSha(spec), compilerRevision: catalog.compilerRevision, catalogRevision: catalog.catalogRevision, active: false};
    const trace = {name: 'exact reviewed workflow and durable submission identity', init: action('initFor', false), expect: {'s.intentSaved': await store.read(key) !== null}, steps: []};
    const checked = await client.verifyPhoneValidation(validation, spec, catalog);
    trace.steps.push({label: 'real validation binds canonical spec digest', action: action('validate'), expect: {'s.reviewedVersion': checked.specDigest === validation.specDigest ? 0 : 1}});
    const changed = normalizePhoneSpec({...spec, name: 'Changed'});
    await assert.rejects(client.verifyPhoneValidation(validation, changed, catalog));
    trace.steps.push({label: 'edited workflow cannot reuse prior review', action: action('edit'), expect: {'s.version': changed.name === spec.name ? 0 : 1}});
    const secondValidation = {...validation, spec: changed, specDigest: await workflowSha(changed)};
    const second = await client.verifyPhoneValidation(secondValidation, changed, catalog);
    const receipt = parsePhoneReceipt({mutationId: 'mutation-A', workflowId: 'workflow-A', operation: 'create', previousVersionId: null, versionId: 'version-A', specDigest: second.specDigest, compilerRevision: catalog.compilerRevision, appliedAt: '2026-11-07T00:00:00Z'}, {mutationId: 'mutation-A', specDigest: second.specDigest, compilerRevision: catalog.compilerRevision});
    trace.steps.push({label: 'real exact-version receipt accepts save', action: [action('validate'), action('save')], expect: {'s.reviewedVersion': receipt.specDigest === secondValidation.specDigest ? 1 : 0}});
    const raw = await store.admit(key, {workflowId: receipt.workflowId, versionId: receipt.versionId});
    trace.steps.push({label: 'real intent store commits before any execution', action: action('retainSubmission', true), expect: {'s.intentSaved': (await store.read(key)) === raw}});
    await assert.rejects(store.admit(key, {workflowId: 'other'}));
    trace.steps.push({label: 'same submission key cannot be admitted twice', action: {...action('retainSubmission', true), reject: true}, expect: {'s.intentSaved': (await store.read(key)) === raw}});
    const restarted = new WorkflowIntentStore(owner); await restarted.load();
    trace.steps.push({label: 'new store restores the exact pending identity', action: action('restart'), expect: {'s.intentSaved': (await restarted.read(key)) === raw}});
    return await checkTraces({model: 'WorkflowExecution', sources: inputs, driverHashes, traces: [trace], scope: 'bounded-component', assumptions: ['Real canonicalization, digest validation, save-receipt validation and Android renderer intent-store path execute.', 'The controlled storage object supplies localStorage semantics; IndexedDB browser storage has its own domain tests.', 'Execution admission, upstream graph effects, approval and trigger runtime are not represented by these observations and remain explicit obligations.']});
  } finally { globalThis.window = original.window; globalThis.localStorage = original.localStorage; }
}
