import { returnToApps } from './app-navigation';
import { test, expect, type Page } from '@playwright/test';

// Owner prep for #667 (H-16, H-35). Test-mocks renderer with a synthetic Cloud Maps provider: the
// real Maps screen, the real Cloud failure mapping (cloudMapsFailure) and no network provider.
// It shows what Alpha renders for OpenStreetMap credit and for each typed Cloud Maps refusal. It is
// not evidence of a deployed Cloud Maps service, real coverage or a device.

const ATTRIBUTION = '© OpenStreetMap contributors (ODbL). Search: Nominatim. Routing: GraphHopper.';

async function openMaps(page: Page, refusal: { status: number; code: string; retryAfterSeconds?: number } | null) {
  await page.goto('/?mode=dev');
  await page.evaluate(async ({ refusal, attribution }) => {
    const { configureMapsProvider } = await import('/src/maps/runtime.ts');
    const { cloudMapsFailure } = await import('/src/maps/cloud-provider.ts');
    const { readServiceLimit } = await import('/src/runtime/subscription-entitlement.ts');
    const point = { latitude: 43.7347, longitude: 7.4206 };
    const place = { providerId: 'eliza-cloud-osm', id: 'N1234', name: 'Port Hercule', coordinate: point, address: 'Port Hercule, Monaco', attribution, fetchedAt: Date.now() };
    const failure = () => {
      const error = Object.assign(new Error(`Eliza Cloud http (${refusal!.status})`), { name: 'CloudProtocolError', code: 'http', status: refusal!.status,
        data: { code: refusal!.code, ...(refusal!.retryAfterSeconds ? { retryAfterSeconds: refusal!.retryAfterSeconds } : {}) } });
      return cloudMapsFailure(error, undefined, readServiceLimit);
    };
    (window as any).expectedRefusal = refusal ? failure().message : null;
    configureMapsProvider({ status: 'configured', providerId: 'eliza-cloud-osm', connectionId: 'conn_eliza_cloud_maps_osm', revision: 'osm-monaco-2026-09-29',
      capabilities: { map: false, search: true, placeDetails: true, modes: ['drive', 'walk', 'bicycle'], traffic: 'none', transit: 'none', offline: { map: false, search: false, routing: false } } },
    { providerId: 'eliza-cloud-osm', connectionId: 'conn_eliza_cloud_maps_osm',
      search: async () => { if (refusal) throw failure(); return [place]; },
      detail: async () => place,
      route: async () => { throw failure(); } } as any);
  }, { refusal, attribution: ATTRIBUTION });
  await returnToApps(page);
  await page.getByRole('button', { name: 'Maps', exact: true }).click();
  const query = page.getByRole('textbox', { name: 'Search places', exact: true });
  await query.fill('Port');
  await query.press('Enter');
}

test('Maps keeps the OpenStreetMap copyright credit visible beside Cloud results', async ({ page }) => {
  await openMaps(page, null);
  await expect(page.getByRole('button', { name: /^Port Hercule/ }).first()).toBeVisible();
  const credit = page.locator('.alpha-map-credits a[href="https://www.openstreetmap.org/copyright"]');
  await expect(credit).toBeVisible();
  await expect(credit).toContainText(/OpenStreetMap/);
});

const REFUSALS = [
  { status: 503, code: 'maps_allowance_unconfigured', text: /not available yet/ },
  { status: 503, code: 'maps_not_configured', text: /./ },
  { status: 403, code: 'subscription_required', text: /./ },
  { status: 422, code: 'unsupported_region', text: /./ },
  { status: 429, code: 'rate_limited', retryAfterSeconds: 42, text: /Try again in about 42 seconds/ },
  { status: 429, code: 'allowance_exhausted', text: /used your Maps allowance/ },
  { status: 503, code: 'provider_unavailable', text: /./ },
];
for (const refusal of REFUSALS) {
  test(`a typed Cloud refusal is shown as its own message, with no invented result: ${refusal.code}`, async ({ page }) => {
    await openMaps(page, refusal);
    const expected = await page.evaluate(() => (window as any).expectedRefusal as string);
    expect(expected).toMatch(refusal.text);
    await expect(page.locator('[data-alpha-maps-status] [role="status"]')).toHaveText(expected);
    await expect(page.getByRole('button', { name: /^Port Hercule/ })).toHaveCount(0);
  });
}
