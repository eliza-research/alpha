/** Only the existing plain, owner-scoped navigation preparation may cross the bridge. */
export function isPreparedViewNavigationRequest(path: string, body: unknown, method = 'POST'): boolean {
  if (method !== 'POST' || typeof path !== 'string' || /[\x00-\x20\x7f%?#\\]/.test(path) || /^\/api\/views\/[A-Za-z0-9_-]+\/navigate$/.exec(path)?.[0] !== path || !body || typeof body !== 'object' || Array.isArray(body)) return false;
  const value = body as Record<string, unknown>;
  return Object.keys(value).length === 5 && Object.keys(value).every(key => ['clientId', 'delivery', 'prepareOnly', 'viewType', 'completedActionHandoffId'].includes(key)) &&
    value.delivery === 'completed-action' && value.prepareOnly === true && value.viewType === 'gui' &&
    typeof value.clientId === 'string' && /^[A-Za-z0-9._-]{1,128}$/.exec(value.clientId)?.[0] === value.clientId &&
    typeof value.completedActionHandoffId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.exec(value.completedActionHandoffId)?.[0] === value.completedActionHandoffId;
}
