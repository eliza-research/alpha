import {HostedDigestProtocol} from '../../apps/app/src/runtime/hosted-digests.ts';

export function fixtureDigestProtocol(
  results: HostedDigestProtocol['results'],
  ack: HostedDigestProtocol['ack'] = async () => { throw Error('Unexpected digest acknowledgment'); },
): HostedDigestProtocol {
  const client = new HostedDigestProtocol(async () => { throw Error('Unexpected digest transport request'); });
  return Object.assign(client, {results, ack});
}
