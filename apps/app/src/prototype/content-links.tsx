import React from 'react';

type LinkHost = {
  live: boolean;
  S(): {view?: string};
  browserOpenContentLink?(url: string, signal: AbortSignal): Promise<(() => void) | undefined>;
  toast(message: string): void;
  contentLinkAbort?: AbortController;
};

/** A user-selected web link uses the existing Browser tab and navigation checks. */
export async function openContentLink(host: LinkHost, raw: string) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('This link cannot open in Browser.');
  host.contentLinkAbort?.abort();
  const abort = host.contentLinkAbort = new AbortController();
  const originView = host.S().view;
  try {
    if (!host.browserOpenContentLink) throw new Error('Browser is unavailable.');
    const present = await host.browserOpenContentLink(url.href, abort.signal);
    if (host.live && !abort.signal.aborted && host.S().view === originView) present?.();
  } finally {
    if (host.contentLinkAbort === abort) host.contentLinkAbort = undefined;
  }
}

/** React text nodes preserve message text while HTTP(S) links gain an explicit target. */
export function linkedMessageText(text: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"'`]+)/gi;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const raw = match[2] || match[3].replace(/[.,;!?]+$/, '');
    let url: URL;
    try { url = new URL(raw); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
    nodes.push(text.slice(offset, match.index));
    nodes.push(<a key={match.index} className="alpha-message-link" href={url.href}
      onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>{match[1] || raw}</a>);
    offset = match.index! + (match[2] ? match[0].length : raw.length);
  }
  if (!nodes.length) return text;
  nodes.push(text.slice(offset));
  return <>{nodes}</>;
}

export function installContentLinks(Component: any) {
  const prototype = Component.prototype;
  const render = prototype.renderVals, mount = prototype.componentDidMount, unmount = prototype.componentWillUnmount;
  prototype.renderVals = function () {
    const result = render.call(this);
    result.msgs = (result.msgs || []).map((message: any) => ({
      ...message,
      linkedText: linkedMessageText(String(message.isAgent ? message.displayText ?? message.text ?? '' : message.text ?? '')),
    }));
    return result;
  };
  prototype.componentDidMount = function () {
    mount?.call(this);
    this.contentLinkClick = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || !anchor.closest('.os') || anchor.hasAttribute('download') || anchor.hasAttribute('data-alpha-external')) return;
      const raw = anchor.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(raw)) return;
      event.preventDefault();
      event.stopPropagation();
      void openContentLink(this, raw).catch(error => {
        if (this.live && error?.name !== 'AbortError') this.toast(error instanceof Error ? error.message : 'Browser could not open this link.');
      });
    };
    document.addEventListener('click', this.contentLinkClick, true);
  };
  prototype.componentWillUnmount = function () {
    this.contentLinkAbort?.abort();
    document.removeEventListener('click', this.contentLinkClick, true);
    return unmount?.call(this);
  };
}
