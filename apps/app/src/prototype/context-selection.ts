/** Selection identity and review scope for sources whose own views publish them:
 * the Files folder being browsed, the open Settings page, a pressed Alpha Phone
 * notification and the capture a question is about. Dependency-free so the rules
 * run in node tests (test/context-selection.test.mjs).
 *
 * Identities are opaque. A display name, path or provider URI never becomes an
 * identity, and neither does a folder's or a capture's own revision string (those
 * embed names, sizes and times): their shared revision is a counter local to this
 * app session. Content is shared only as an excerpt the owner reviewed. */
type Bag = Record<string, any>;
const OPAQUE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const FOLDER_CONTEXT_EVENT = 'alpha-folder-context';

export type FolderScopeEntry = { id: string; revision: string; name: string; mimeType: string; directory: boolean };
/** Exactly what a folder review covers: one folder and the entries loaded for it. */
export type FolderScope = {
  folder: { id: string; revision: string; name: string };
  entries: FolderScopeEntry[];
  /** Entries the provider reported for the folder, when known. */
  total?: number;
  /** More entries exist than the loaded ones. */
  more: boolean;
};
type Listed = { folder?: Bag; entries?: Bag[]; total?: number; cursor?: string; truncated?: boolean };

const entryOf = (value: Bag): FolderScopeEntry | undefined =>
  value && typeof value.id === 'string' && typeof value.revision === 'string' && typeof value.name === 'string'
    ? { id: value.id, revision: value.revision, name: value.name, mimeType: typeof value.mimeType === 'string' ? value.mimeType : '', directory: value.directory === true }
    : undefined;

/** The reviewable scope of a ready folder listing, or undefined when it has no usable identity. */
export function folderScope(listing: Listed | undefined): FolderScope | undefined {
  const folder = listing?.folder;
  if (!folder || typeof folder.id !== 'string' || !OPAQUE.test(folder.id) || typeof folder.revision !== 'string') return undefined;
  const entries: FolderScopeEntry[] = [];
  for (const row of listing!.entries || []) { const entry = entryOf(row); if (!entry) return undefined; entries.push(entry); }
  return {
    folder: { id: folder.id, revision: folder.revision, name: typeof folder.name === 'string' && folder.name ? folder.name : 'Selected folder' },
    entries, more: !!listing!.cursor || listing!.truncated === true,
    ...(Number.isSafeInteger(listing!.total) ? { total: listing!.total } : {}),
  };
}

/** Local comparison key. It contains provider revisions (which may embed names), so it is never sent. */
export function folderSignature(scope: FolderScope): string {
  return JSON.stringify([scope.folder.id, scope.folder.revision, scope.entries.map(entry => [entry.id, entry.revision]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)]);
}

/** Random per app session, so a later session can never repeat a revision for other content. */
const sessionMarker = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => byte.toString(16).padStart(2, '0')).join('');
export type FolderSelection = { kind: 'folder'; id: string; revision: string };
const FOLDER_REVISIONS_KEPT = 64;
/** Maps each distinct listing of a folder to a counter that is local to this app session.
 * The counter (with a random session marker, so a later session can never repeat it for
 * other content) is the only revision that leaves the phone: it changes whenever the folder
 * or a loaded entry changes, and reveals nothing about names, sizes or times. */
export function createFolderRevisions() {
  const seen = new Map<string, { signature: string; revision: number }>();
  const session = sessionMarker();
  let counter = 0;
  return (scope: FolderScope | undefined): FolderSelection | undefined => {
    if (!scope) return undefined;
    const signature = folderSignature(scope), previous = seen.get(scope.folder.id);
    const revision = previous?.signature === signature ? previous.revision : ++counter;
    // Most recently used last. A forgotten folder simply gets a new revision when revisited.
    seen.delete(scope.folder.id); seen.set(scope.folder.id, { signature, revision });
    if (seen.size > FOLDER_REVISIONS_KEPT) seen.delete(seen.keys().next().value as string);
    return { kind: 'folder', id: scope.folder.id, revision: 'listing-' + session + '-' + revision };
  };
}

export const FOLDER_EXCERPT_LIMIT = 200;
/** Whether a fresh read of the folder still matches what was reviewed. A removed, renamed,
 * replaced or added entry, a changed folder, or lost access all fail. The fresh read is the
 * folder's first page. It must be exactly the entries the review loaded first, it must cover
 * every entry the excerpt names, and the reported total must be unchanged: an entry that left
 * the first page is noticed even when another loaded entry slides into its place. */
export function folderScopeCurrent(reviewed: FolderScope, fresh: Listed & { status?: string }): boolean {
  if (fresh.status !== undefined && fresh.status !== 'ready') return false;
  const now = folderScope(fresh);
  if (!now || now.folder.id !== reviewed.folder.id || now.folder.revision !== reviewed.folder.revision) return false;
  if (now.total !== reviewed.total) return false;
  const count = now.entries.length;
  if (count > reviewed.entries.length || (!now.more && count !== reviewed.entries.length)) return false;
  if (count < Math.min(reviewed.entries.length, FOLDER_EXCERPT_LIMIT)) return false;
  const first = new Map(reviewed.entries.slice(0, count).map(entry => [entry.id, entry.revision]));
  return first.size === count && now.entries.every(entry => first.get(entry.id) === entry.revision);
}

/** The excerpt offered for review: names and types of the loaded entries of this one folder.
 * Nothing inside a file or a subfolder is read. */
export function folderExcerpt(scope: FolderScope, typeLabel: (mimeType: string, directory: boolean) => string): string {
  const shown = scope.entries.slice(0, FOLDER_EXCERPT_LIMIT), hidden = scope.entries.length - shown.length;
  const lines = ['Folder: ' + scope.folder.name];
  if (!shown.length) lines.push(scope.more ? 'Not loaded' : 'Empty');
  else lines.push(shown.length + (shown.length === 1 ? ' entry' : ' entries') + ' listed by name and type. File contents and subfolder contents are not included.');
  for (const entry of shown) lines.push('- ' + entry.name + ' (' + typeLabel(entry.mimeType, entry.directory) + ')');
  if (hidden > 0) lines.push(hidden + ' more loaded ' + (hidden === 1 ? 'entry is' : 'entries are') + ' not listed here.');
  if (scope.more) lines.push('More…' + (scope.total !== undefined ? ' (' + scope.total + ' total)' : ''));
  return lines.join('\n');
}

const SETTINGS_SECTION = /^[a-z][a-z0-9-]{0,63}$/;
const SETTINGS_CATEGORIES = new Set(['settings-account','settings-general','settings-privacy','settings-apps','settings-help']);
const SENSITIVE_SETTINGS = /pass|credential|vault|secret|token|key|unlock|pin|biometric/;
/** The open Settings page as an identity: its section slug only, never a value shown on it.
 * Credential and unlock pages have no identity (the screen is also paused as sensitive). */
export function settingsSelection(state: Bag | undefined): { kind: 'settings'; id: string } | undefined {
  const page = state?.page ?? (SETTINGS_CATEGORIES.has(state?.settingsCategory) ? state?.settingsCategory : undefined);
  if (typeof page !== 'string' || !SETTINGS_SECTION.test(page) || SENSITIVE_SETTINGS.test(page)) return undefined;
  return { kind: 'settings', id: page };
}

export type Notice = { id: string; revision: string; source: string; kind?: string; title?: string; text?: string; appLabel?: string };
/** Own-notice kinds that may be reviewed for a question (AlphaNotificationsPlugin.noticeKind).
 * Hosted results, scheduled digests and workflow notices can carry mail-derived text and are
 * never offered; neither is an unrecognized kind. */
export const ASKABLE_NOTICE_KINDS: readonly string[] = ['reminder', 'calendar', 'navigation'];
/** Android reports each own row's kind. The browser build's own rows carry none: there they are
 * reminders, calendar alerts ('calendar:'), workflow notices ('workflow:') and the messages a
 * workflow Focus block held ('focus:'), which count as workflow notices. */
export function noticeKind(notice: Pick<Notice, 'id' | 'kind'>): string {
  if (notice.kind !== undefined) return notice.kind;
  return /^(workflow|focus):/.test(notice.id) ? 'workflow' : notice.id.startsWith('calendar:') ? 'calendar' : 'reminder';
}
/** What Android's AlphaNotificationsPlugin.list returns in place of a row's title and text
 * while the device is locked or the notification is secret (test/context-selection.test.mjs
 * keeps these in step with the Java source). */
export const HIDDEN_NOTICE_TITLE = 'Alpha Phone notification';
export const HIDDEN_NOTICE_TEXTS: readonly string[] = ['Unlock to view', 'Content hidden'];
/** A row whose content the platform withheld. The browser build shows the app label and no
 * text; Android shows fixed placeholder wording. Neither is the notification's content. */
export function noticeHidden(notice: Notice): boolean {
  const title = (notice.title || '').trim(), text = (notice.text || '').trim();
  if (!text) return !title || title === (notice.appLabel || '').trim() || title === HIDDEN_NOTICE_TITLE;
  return title === HIDDEN_NOTICE_TITLE && HIDDEN_NOTICE_TEXTS.includes(text);
}
/** Only Alpha Phone's own, unredacted notifications of an askable kind can be reviewed for a
 * question. A row hidden by the lock screen or marked secret carries no content, which is
 * nothing to review; a hosted-result, digest or workflow notice may carry mail text. */
export function noticeReviewable(notice: Notice): boolean {
  return notice.source === 'own' && ASKABLE_NOTICE_KINDS.includes(noticeKind(notice)) && OPAQUE.test(notice.id) && OPAQUE.test(notice.revision) && !noticeHidden(notice);
}
/** The exact notification is still listed with the revision that was reviewed. */
export function noticeCurrent(reviewed: Pick<Notice, 'id' | 'revision' | 'source'>, items: readonly Notice[] | undefined): boolean {
  return !!items && items.filter(item => item.id === reviewed.id && item.source === reviewed.source).length === 1
    && items.some(item => item.id === reviewed.id && item.source === reviewed.source && item.revision === reviewed.revision);
}
export function noticeExcerpt(notice: Notice): string {
  return [notice.title, notice.text].map(value => (value || '').trim()).filter(Boolean).join('\n');
}

export type CaptureSelection = { kind: 'photo' | 'video'; id: string; revision: string };
const CAPTURE_REVISIONS_KEPT = 256;
/** Maps each saved photo or video to an identity whose revision is a counter local to this
 * app session. The library's own revision never leaves the phone: on Android it is the item's
 * added time and byte size (AlphaPhotosPlugin.metadata), with a '|generation' suffix the wire
 * contract would refuse once the item was favorited, trashed or restored. The counter changes
 * exactly when that item's library revision or mutation revision changes, so an edited,
 * trashed, restored or replaced capture is never the identity that was shared before. An item
 * without an opaque id or a library revision has no identity. */
export function createCaptureRevisions() {
  const seen = new Map<string, { signature: string; revision: number }>();
  const session = sessionMarker();
  let counter = 0;
  return (row: { kind?: string; id?: unknown; revision?: unknown; mutationRevision?: unknown; contentRevision?: unknown } | undefined): CaptureSelection | null => {
    if (!row || typeof row.id !== 'string' || !OPAQUE.test(row.id) || typeof row.revision !== 'string' || !row.revision) return null;
    const signature = JSON.stringify([row.revision, typeof row.mutationRevision === 'string' ? row.mutationRevision : null, typeof row.contentRevision === 'string' ? row.contentRevision : null]), previous = seen.get(row.id);
    const revision = previous?.signature === signature ? previous.revision : ++counter;
    // Most recently used last. A forgotten item simply gets a new revision when opened again.
    seen.delete(row.id); seen.set(row.id, { signature, revision });
    if (seen.size > CAPTURE_REVISIONS_KEPT) seen.delete(seen.keys().next().value as string);
    return { kind: row.kind === 'video' ? 'video' : 'photo', id: row.id, revision: 'capture-' + session + '-' + revision };
  };
}

/** A saved photo or video as the library reports it. contentRevision (Android: modified time,
 * size and modification generation) changes when another app rewrites the file in place. */
export type CaptureRevisionFields = { trashed?: boolean; revision: string; mutationRevision?: string; contentRevision?: string };
/** The library's current row is still the item that was reviewed: same trash state, same
 * mutation (or library) revision and, when the reviewed row carried one, the same content
 * revision. Anything else, including a row that dropped its content revision, is a changed item
 * and is never used as context. */
export function captureUnchanged(reviewed: CaptureRevisionFields, current: CaptureRevisionFields | undefined): boolean {
  if (!current || !current.trashed !== !reviewed.trashed) return false;
  if (reviewed.mutationRevision ? current.mutationRevision !== reviewed.mutationRevision : current.revision !== reviewed.revision) return false;
  return reviewed.contentRevision === undefined || current.contentRevision === reviewed.contentRevision;
}

export type CaptureQuestion =
  /** The live viewfinder frame. */
  | { kind: 'frame' }
  /** One saved photo or video, by its exact library identity. */
  | { kind: 'item'; id: string }
  /** A typed library search. It names no capture and reads no media. */
  | { kind: 'search' }
  /** The viewer is open on something this adapter does not own. */
  | { kind: 'none' };
/** Routes a Camera or Photos question control to what it is about. A search question is
 * never treated as a capture, and a viewer question always carries the open item's id. */
export function captureQuestion(module: string, key: string, path: string, state: Bag | undefined): CaptureQuestion | undefined {
  if (module !== 'camera' && module !== 'photos') return undefined;
  if (key === 'askQ' || key === 'askSearch') return { kind: 'search' };
  if (key !== 'ask') return undefined;
  if (module === 'camera') return { kind: 'frame' };
  const open = state?.open;
  return path === 'v.ask' && typeof open === 'string' && open ? { kind: 'item', id: open } : { kind: 'none' };
}

const MIME_TYPE = /^[a-z]+\/([a-z0-9][a-z0-9.+-]{0,126}|\*)$/;
/** Document types for a Files location tile, as the list the native picker accepts
 * (DailyAppsPlugin.mimeTypes). Undefined means any document. */
export function locationMimeTypes(name: string): string[] | undefined {
  const key = name.toLowerCase();
  const types = /(picture|image|photo)/.test(key) ? ['image/*']
    : /(music|audio|recording)/.test(key) ? ['audio/*']
    : /video|movie/.test(key) ? ['video/*']
    : /doc|pdf/.test(key) ? ['application/pdf', 'text/*', 'application/*']
    : undefined;
  return types?.every(type => MIME_TYPE.test(type)) ? types : undefined;
}

/** Publishes the folder and Settings identities the agent context reads from the shell.
 * The folder identity exists only while its folder is the visible Files subview. */
export function installContextSelection(Component: any) {
  const p = Component.prototype, mount = p.componentDidMount, unmount = p.componentWillUnmount;
  p.componentDidMount = function () {
    mount?.call(this);
    this.alphaFolderContextHandler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const next = detail && detail.kind === 'folder' && typeof detail.id === 'string' && OPAQUE.test(detail.id) && typeof detail.revision === 'string' && OPAQUE.test(detail.revision)
        ? { kind: 'folder' as const, id: detail.id, revision: detail.revision } : undefined;
      if (JSON.stringify(next) === JSON.stringify(this.alphaFolderSelection)) return;
      this.alphaFolderSelection = next;
      // Re-render so the agent context is recomputed with the new identity.
      this.setState({ folderContextRevision: Date.now() });
    };
    window.addEventListener(FOLDER_CONTEXT_EVENT, this.alphaFolderContextHandler);
  };
  p.componentWillUnmount = function () {
    window.removeEventListener(FOLDER_CONTEXT_EVENT, this.alphaFolderContextHandler);
    this.alphaFolderSelection = undefined;
    unmount?.call(this);
  };
  p.folderSelection = function (): FolderSelection | undefined {
    const chosen = this.alphaFolderSelection as FolderSelection | undefined;
    if (!chosen || document.hidden || this.S().view !== 'files') return undefined;
    const files = this.vget('files');
    return files.folder === '__native_tree' && !files.open ? { ...chosen } : undefined;
  };
  p.settingsSelection = function () {
    return document.hidden || this.S().view !== 'settings' ? undefined : settingsSelection(this.vget('settings'));
  };
}
