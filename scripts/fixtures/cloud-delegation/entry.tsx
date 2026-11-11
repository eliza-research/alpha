import {useLayoutEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {HostedLiveSourcePicker} from '../../../apps/app/src/runtime/hosted-live-source-ui';
import {HostedDigestProtocol} from '../../../apps/app/src/runtime/hosted-digests';
import '../../../apps/app/src/runtime/connection-ui.css';
import {controls} from './controls.ts';

const controller = new AbortController();
let active = 'a'.repeat(64);
const client = new HostedDigestProtocol(async (path, body) => {
  if (path.endsWith('/live-accounts')) controls.connected++;
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: {'content-type': 'application/json', 'x-fixture-owner': active},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw Error('request failed');
  return response.json();
});

function App() {
  const [owner, setOwner] = useState(active);
  const section = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const picker = section.current?.querySelector('details');
    if (picker) picker.open = true;
  }, [owner]);
  controls.switchOwner = value => { active = value; setOwner(value); };
  return <section ref={section} data-fixture-owner={owner} className="alpha-connection">
    <HostedLiveSourcePicker key={owner} client={client} scope={owner} signal={controller.signal}
      current={() => active === owner} busy={false} review={() => {}} />
  </section>;
}

const root = document.getElementById('root');
if (!root) throw Error('Missing fixture root');
createRoot(root).render(<App />);
