/** Read-only chat search and centered history routes shared by browser transports. */
export function conversationReadPathAllowed(path: unknown): path is string {
  if (typeof path !== 'string' || path.length > 2048) return false;
  return /^\/api\/conversations\/messages\/search\?q=(?:[A-Za-z0-9_.*+~-]|%[0-9A-Fa-f]{2})+&limit=50&offset=[0-9]{1,9}$/.test(path)
    || /^\/api\/conversations\/[A-Za-z0-9_-]+\/messages\?around=[0-9a-fA-F-]{36}$/.test(path);
}
