import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {manifestComponents} from './aosp-provisioning-overlay.ts';
import type {ReviewedSourcePatch} from './pixel10a-source-contract.ts';

const gates = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'] as const;
const digest = /^[a-f0-9]{64}$/;
const packagePattern = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const powerPermission = 'android.permission.STATUS_BAR_SERVICE';
const assistantAction = 'android.intent.action.ASSIST';
const defaultCategory = 'android.intent.category.DEFAULT';

export interface SenseImageActivation {
  feature: string;
  assistant: string;
  power: string;
  qualificationSha256: string;
  qualificationPassed: boolean;
}

interface SenseImageInputs {
  appId: string;
  launcherSha256: string;
  listenerSha256: string;
  launcherDescriptorSha256: string;
  listenerDescriptorSha256: string;
  certificateSha256: string;
  sourceLockSha256: string;
  sdkCommit: string;
  sepolicySha256: string;
  patches: readonly ReviewedSourcePatch[];
}

interface ListenerQualification {
  schemaVersion: 1;
  target: 'pixel10a';
  qualified: boolean;
  packageName: string;
  launcherSha256: string;
  listenerSha256: string;
  launcherDescriptorSha256: string;
  listenerDescriptorSha256: string;
  certificateSha256: string;
  sourceLockSha256: string;
  sdkCommit: string;
  sepolicySha256: string;
  patchManifests: Record<string, string>;
  gates?: Partial<Record<(typeof gates)[number], {status: 'passed'; evidenceSha256: string}>>;
}

/** The product descriptor enrolls the exact reviewed record. A caller-supplied file cannot self-admit. */
export function readSenseQualification(file: string, enrolledSha256: unknown, production: boolean) {
  if (typeof enrolledSha256 !== 'string' || !digest.test(enrolledSha256))
    throw Error('Pixel 10a product has no reviewed listener qualification digest');
  const bytes = fs.readFileSync(file);
  if (createHash('sha256').update(bytes).digest('hex') !== enrolledSha256)
    throw Error('Listener qualification bytes differ from the Pixel 10a product descriptor');
  const record = JSON.parse(bytes.toString('utf8')) as ListenerQualification | null;
  if (record?.schemaVersion !== 1 || record.target !== 'pixel10a' || typeof record.qualified !== 'boolean')
    throw Error('The enrolled listener qualification must name Pixel 10a');
  if (production && !record.qualified) throw Error('Production Sense requires passing Pixel 10a qualification');
  for (const gate of record.qualified ? gates : []) {
    const result = record.gates?.[gate];
    if (result?.status !== 'passed' || typeof result.evidenceSha256 !== 'string' || !digest.test(result.evidenceSha256))
      throw Error(`Listener qualification ${gate} requires an exact passing evidence digest`);
  }
  return record;
}

export function assertSenseQualification(record: ListenerQualification, input: SenseImageInputs) {
  const exact = {
    packageName: `${input.appId}.sense`, launcherSha256: input.launcherSha256,
    listenerSha256: input.listenerSha256, certificateSha256: input.certificateSha256,
    launcherDescriptorSha256: input.launcherDescriptorSha256, listenerDescriptorSha256: input.listenerDescriptorSha256,
    sourceLockSha256: input.sourceLockSha256, sdkCommit: input.sdkCommit, sepolicySha256: input.sepolicySha256,
  };
  for (const [name, value] of Object.entries(exact)) {
    const pattern = name === 'packageName' ? packagePattern : name === 'sdkCommit' ? /^[a-f0-9]{40}$/ : digest;
    if (typeof value !== 'string' || !pattern.test(value) || record[name as keyof typeof exact] !== value)
      throw Error(`Listener qualification ${name} differs from the image inputs`);
  }
  const patches = record.patchManifests;
  if (!patches || Object.keys(patches).length !== input.patches.length ||
      input.patches.some(({name, manifestSha256}) => !Object.hasOwn(patches, name) || patches[name] !== manifestSha256))
    throw Error('Listener qualification patch manifests differ from the verified source');
}

export function senseLauncherDigest(file: string, admittedSha256: string) {
  const stagedSha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (stagedSha256 !== admittedSha256) throw Error('Staged Sense launcher differs from the admitted release APK');
  return stagedSha256;
}

/** Check the presigned launcher before the image changes its default-disabled component states. */
export function assertSenseLauncher(tree: string, appId: string) {
  if (!packagePattern.test(appId)) throw Error('Invalid Sense launcher package');
  const rows = manifestComponents(tree);
  const qualify = (name: string | undefined) => name?.startsWith('.') ? appId + name : name;
  const assistant = `${appId}.AlphaAssistActivity`, power = `${appId}.AlphaPowerVoiceActivity`;
  const component = (name: string) => {
    const matches = rows.filter(row => qualify(row.name) === name);
    if (matches.length !== 1 || matches[0].tag !== 'activity' ||
        !['false', '0x0'].includes(matches[0].enabled) || !['true', '0xffffffff'].includes(matches[0].exported))
      throw Error(`Qualified Sense requires ${name} exported and disabled by default`);
    return matches[0];
  };
  const assist = component(assistant), child = component(power);
  const [filter] = assist.filters as {actions: string[]; categories: string[]}[];
  if (assist.permission || assist.filters.length !== 1 || !filter || filter.actions.length !== 1 || filter.actions[0] !== assistantAction ||
      filter.categories.length !== 1 || filter.categories[0] !== defaultCategory)
    throw Error('Qualified Sense requires the exact ordinary ACTION_ASSIST surface');
  if (child.permission !== powerPermission || child.filters.length !== 0)
    throw Error('Qualified Sense requires a protected explicit Power child with no intent filter');
  return {assistant, power};
}

/** Called only after the exact listener, launcher, source and policy pass admission. */
export function writeSenseImageActivation(output: string, appId: string, tree: string) {
  const {assistant, power} = assertSenseLauncher(tree, appId);
  const feature = `${appId}.feature.SENSE`;
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<config>\n` +
    `    <feature name="${feature}" version="1" />\n` +
    `    <component-override package="${appId}">\n` +
    `        <component class="${assistant}" enabled="true" />\n` +
    `        <component class="${power}" enabled="true" />\n` +
    `    </component-override>\n</config>\n`;
  const name = 'alpha-sense-image.xml';
  fs.writeFileSync(path.join(output, 'listener', name), xml, {flag: 'wx'});
  fs.appendFileSync(path.join(output, 'listener', 'listener.mk'),
    `\nPRODUCT_COPY_FILES += $(sense_listener_dir)/${name}:$(TARGET_COPY_OUT_SYSTEM_EXT)/etc/sysconfig/${name}\n`);
  return {feature, assistant, power};
}
