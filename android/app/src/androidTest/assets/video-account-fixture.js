// Test APK only: qualify Camera/Photos through the production account UI without real Cloud
// traffic. Installed before startup settles, so the required sign-in page's readiness probe
// reaches it. The real resident starts first (P-43) and its status and stop stay native; only the
// account binding and the bound start are synthetic. Media and other native plugins stay real.
(() => {
  if (window.__alphaVideoAccount) throw Error('Video account fixture already installed');
  const native = Capacitor.nativePromise;
  const id = '9f1dc45a-4011-4e44-947a-30d999d24fa5';
  const session = '12345678-1234-4234-8234-123456789def';
  let credential = null, binding = null, running = false;
  const calls = [];
  window.__alphaVideoAccount = { calls };
  Capacitor.nativePromise = async function(plugin, method, input = {}) {
    // In-app sign-in host: stores a synthetic key the way AlphaCloudSignInPlugin does and returns
    // only the non-secret outcome. No Steward, Cloud or browser traffic.
    if (plugin === 'AlphaCloudSignIn') {
      calls.push('signIn:' + method);
      if (method === 'cancel') return {};
      if (method === 'status') return { active: false, inApp: true, google: false, email: true };
      if (method === 'savedSignInRecoveryStatus') return { eligible: false };
      if (method === 'startEmail') {
        if (input.email !== 'video-fixture@example.invalid' || input.environment !== 'production') throw Error('Unexpected sign-in request');
        return { attemptId: session, expiresAt: Date.now() + 600000, resendAt: Date.now() + 60000 };
      }
      if (method === 'verifyEmail') {
        if (input.attemptId !== session || input.code !== '123456') throw Object.assign(Error('invalid-code'), { code: 'invalid-code' });
        const expiresAt = Date.now() + 30 * 24 * 3600 * 1000;
        credential = JSON.stringify({ credentialId: crypto.randomUUID(), token: 'synthetic-video-account-only', expiresAt });
        return { status: 'authenticated', environment: 'production', expiresAt, accountCreated: false };
      }
      throw Error('Unexpected sign-in operation');
    }
    if (plugin === 'AlphaConnection') {
      if (input.slot === 'cloud:production') {
        if (method === 'secureRead') return { value: credential };
        if (method === 'secureWrite') { credential = input.value; return {}; }
        if (method === 'secureRemove') { credential = null; return {}; }
      }
      if (method === 'openExternal') throw Error('In-app sign-in opens no page');
      if (method === 'request') {
        const url = new URL(input.url);
        if (url.origin !== 'https://api.eliza.app' || url.search || url.hash) throw Error('Unexpected account authority');
        const path = url.pathname;
        calls.push(path);
        const saved = credential && JSON.parse(credential);
        if (!saved || input.headers?.Authorization !== `Bearer ${saved.token}` || input.method !== 'GET') throw Error('Unbound account request');
        if (path === '/api/v1/user') return { status: 200, data: { success: true, data: { id } } };
        if (path === '/api/v1/subscription/entitlement') return { status: 404, data: {} }; // Entitlement route absent: the billing snapshot answers.
        if (path === '/api/v1/billing/limits') return { status: 200, data: { success: true, data: { v2: { subscription: { status: 'available', value: { planKey: 'plus_monthly', state: 'active', currentPeriodEnd: '2099-01-01T00:00:00.000Z' } } } } } };
        throw Error('Unexpected account request');
      }
    }
    if (plugin === 'Agent') {
      // Until the synthetic account is bound this is the real resident: forward it unchanged.
      const forward = !binding && method !== 'configureCloudProvider' || method === 'stop' || method === 'getStatus' && !running;
      calls.push(forward ? 'native:' + method : method);
      if (method === 'stop') running = false;
      if (forward) return native.apply(this, arguments);
      if (method === 'getStatus') return { packaged: true, state: 'running', serviceActive: true, socketListening: true };
      if (method === 'configureCloudProvider') {
        const saved = credential && JSON.parse(credential);
        if (!saved || input.credentialId !== saved.credentialId || input.model !== 'cerebras/qwen-3.8-27b') throw Error('Unbound resident account');
        binding = input.credentialId; return { configured: true };
      }
      if (method === 'start') {
        const saved = credential && JSON.parse(credential);
        if (!saved || binding !== saved.credentialId) throw Error('Unbound resident startup');
        running = true; return {};
      }
      if (method === 'cancelStart') { running = false; return {}; }
      if (method === 'request' && running) {
        let body;
        if (input.path === '/api/auth/me' && input.method === 'GET') body = { identity: { id, kind: 'owner' }, access: { role: 'OWNER', mode: 'local' } };
        else if (input.path === '/api/agents' && input.method === 'GET') body = { agents: [{ id, name: 'Synthetic video admission', status: 'running' }] };
        else if (input.path === '/api/client-devices/register' && input.method === 'POST') body = { installationId: input.headers['X-Eliza-Device-Id'], enrollmentId: 'video-fixture-enrollment', capabilities: [] };
        else if (input.path === '/api/conversations' && input.method === 'GET') body = { conversations: [] };
        else if (input.path === '/api/workflow/status' && input.method === 'GET') body = {};
        else throw Error('Unexpected resident request');
        return { status: 200, body: JSON.stringify(body) };
      }
      throw Error('Unexpected resident operation');
    }
    return native.apply(this, arguments);
  };
})();
