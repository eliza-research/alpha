// Build-time switch for mock, fixture and developer surfaces. Off unless ELIZA_DEV_ALLOW_TEST_MOCKS=1.
export const testMocksEnabled: boolean = import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS === '1';
export const devSurfacesEnabled: boolean = import.meta.env.DEV && testMocksEnabled;

// Explicit production deployment policy; independent of all developer/mock switches.
export const cloudRuntimeEnabled: boolean = import.meta.env.VITE_ELIZA_RUNTIME_PROFILE === 'cloud';

export const privateLocalPreviewEnabled: boolean = import.meta.env !== undefined && import.meta.env.DEV === true && import.meta.env.VITE_ALPHA_PRIVATE_LOCAL_PREVIEW === '1' && import.meta.env.VITE_LOCAL_AGENT === '1';

// Read-only OS update-channel check (the shared elizaOS update-channel client, which verifies the
// signed channel against the booted build and never downloads or applies). Registered off: the
// product does not check for updates. Only a development build (ELIZA_DEV_ALLOW_TEST_MOCKS=1)
// shows its state, in About.
export const updateChannelCheckEnabled = false as boolean;
