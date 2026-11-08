import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {app, directory, javaTraces} from './java.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {residentSources} from './resident-coordinator.mjs';
import {credentialCoordinatorPlatform} from './credential-coordinator-platform.mjs';

export const credentialCoordinatorSources = [
  ...residentSources,
  ...['AlphaCredentialStore.java', 'AlphaConnectionPlugin.java', 'SerialStorageTasks.java',
    'RendererCredentialSlots.java', 'ConnectionRoutes.java', 'GoogleConnectReturn.java',
    'CalendarSyncConsent.java'].map(name => app + name),
];
export const credentialScenarios = [
  'cloud-write', 'cloud-remove', 'same-cloud', 'ordinary', 'unbound', 'other-environment',
  'oversize', 'write-before', 'write-after', 'strip-before', 'provider-clear', 'provider-bind',
  'late-connection-write', 'late-connection-remove', 'late-native-clear', 'late-native-bind', 'late-native-provider',
  'shutdown-timeout', 'stop-failed', 'provider-new-bind', 'identity-refused', 'bind-write-after',
  'provider-clear-after', 'concurrent-owner', 'retry-shutdown', 'compare-conflict', 'read-failed',
  'clear-then-cloud', 'observer-refused', 'reservation-race', 'absent-without-ack', 'ack-with-live-process',
];

export function generateCredentialCoordinatorTraces(scenario) {
  const fixture = credentialCoordinatorPlatform();
  const sources = [...credentialCoordinatorSources,
    ...['CredentialCoordinatorPorts.java', 'CredentialCoordinatorTraces.java', 'CredentialResidentTraces.java',
      'ResidentTestPorts.java', 'resident-platform.mjs', 'resident-coordinator.mjs',
      'credential-coordinator-platform.mjs', 'Trace.java', 'java.mjs'].map(name => `${directory}/${name}`),
    fileURLToPath(import.meta.url),
  ];
  try {
    const driverHashes = captureInputs(sources);
    const javaSources = [...credentialCoordinatorSources, ...fixture.paths,
      `${directory}/CredentialCoordinatorPorts.java`, `${directory}/ResidentTestPorts.java`];
    const groups = scenario === 'resident-retirement'
      ? {NativeCredentialMutation: [], ResidentRuntime: javaTraces('CredentialResidentTraces.java',
        [...javaSources, `${directory}/CredentialCoordinatorTraces.java`], [fixture.directory])}
      : scenario
      ? {NativeCredentialMutation: javaTraces('CredentialCoordinatorTraces.java',
        [...javaSources, `${directory}/CredentialResidentTraces.java`], [fixture.directory, scenario]), ResidentRuntime: []}
      : javaTraces('CredentialCoordinatorTraces.java', [...javaSources, `${directory}/CredentialResidentTraces.java`],
        [fixture.directory, 'campaign', ...credentialScenarios, 'resident-retirement']);
    return {groups, sources, driverHashes,
      fixtureSha256: createHash('sha256').update(JSON.stringify(fixture.sources)).digest('hex')};
  } finally {
    fixture.close();
  }
}

export async function checkCredentialCoordinator() {
  const data = generateCredentialCoordinatorTraces();
  const receipts = [];
  for (const [model, traces] of Object.entries(data.groups)) {
    receipts.push(await checkTraces({model, id: `${model}-credential-coordinator`, scope: 'bounded-orchestration',
      traces, sources: data.sources, driverHashes: data.driverHashes, assumptions: [
        `Actual AlphaConnectionPlugin, AlphaCredentialStore and AlphaLocalAgentPlugin execute under external ports ${data.fixtureSha256}.`,
        'Credential class is the selected synthetic slot value. Runtime admission combines stored provider validity with actual accepting/stopping flags.',
        'Selected committed writes and strict shutdown requests are observed separately from reported plugin results.',
        'Real Android encrypted storage, provider/network and service-process behavior remain integration obligations.',
      ]}));
  }
  return {receipts, obligations: [
    {model: 'NativeCredentialMutation', obligation: 'Actual encrypted-store and service-process execution',
      reason: 'The product plugins and store coordinator execute against controlled storage primitives and service replies.'},
    {model: 'ResidentRuntime', obligation: 'Kernel/Binder cancellation and arbitrary lifecycle schedules',
      reason: 'The source request and stream callbacks execute under a finite controlled schedule.'},
  ]};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2]) console.log(JSON.stringify(generateCredentialCoordinatorTraces(process.argv[2]), null, 2));
  else console.log(JSON.stringify(await checkCredentialCoordinator(), null, 2));
}
