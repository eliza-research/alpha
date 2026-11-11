import type {CloudEnvironment} from './cloud-protocol';

/** A public preview default never selects an issuer for a production/native build or replaces an explicit choice. */
export function resolveCloudEnvironment(policy: {development: boolean; testMocks: boolean; android: boolean; previewEnvironment?: unknown; cloudResident?:boolean}, selected?: unknown): CloudEnvironment {
  return resolveCloudEnvironmentCore(
    {development: policy.development, testMocks: policy.testMocks, android: policy.android, previewStaging: policy.previewEnvironment === 'staging', cloudResident: !!policy.cloudResident},
    typeof selected === 'string' ? selected : '');
}
export type CloudEnvironmentPolicy = {development: boolean; testMocks: boolean; android: boolean; previewStaging: boolean; cloudResident: boolean};
/** The decision core of `resolveCloudEnvironment` over plain flags; a non-text `selected` arrives as ''. */
export function resolveCloudEnvironmentCore(policy: CloudEnvironmentPolicy, selected: string): 'production' | 'staging' {
  //@ verify
  //@ ensures \result === 'production' || \result === 'staging'
  //@ ensures (policy.android && \result === 'staging') ==> (policy.testMocks && selected === 'staging')
  //@ ensures (!policy.development && \result === 'staging') ==> (policy.testMocks && selected === 'staging')
  //@ ensures ((!policy.development || policy.android) && !policy.testMocks) ==> \result === 'production'
  //@ ensures !policy.testMocks && !(policy.development && !policy.android && policy.cloudResident) ==> \result === 'production'
  //@ ensures \result === 'staging' ==> ((policy.testMocks && selected === 'staging') || (policy.development && !policy.android && policy.previewStaging && (policy.cloudResident || policy.testMocks)))
  //@ ensures selected === 'production' && !(policy.development && !policy.android && policy.cloudResident) ==> \result === 'production'
  //@ ensures policy.testMocks && selected === 'staging' && !(policy.development && !policy.android && policy.cloudResident) ==> \result === 'staging'
  if (policy.development && !policy.android && policy.cloudResident) return policy.previewStaging ? 'staging' : 'production';
  if (selected === 'production') return 'production';
  if (policy.testMocks && selected === 'staging') return 'staging';
  return policy.development && policy.testMocks && !policy.android && policy.previewStaging ? 'staging' : 'production';
}
