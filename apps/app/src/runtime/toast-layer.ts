/**
 * Feedback inside a top-layer dialog.
 *
 * The phone's toast region lives in the page. A modal `<dialog>` is drawn in the browser's top
 * layer and makes everything outside itself inert, so a toast raised while one is open ("Saved",
 * a refusal, "Deleted … Undo") was painted underneath the dialog and removed from the
 * accessibility tree: neither seen nor announced.
 *
 * While a modal dialog is open it is given a live region of its own, marked like the page's
 * (aria-live, no role, so a dialog's own role="status" line stays the only status in it): an element inside the
 * dialog (so it is not inert and belongs to what assistive technology reads), in the dialog's
 * normal flow above its content so it cannot cover a field or action, and sticky at the top of a
 * dialog that scrolls its own content so feedback raised while it is scrolled stays in view. The
 * region is present and empty from the moment the dialog opens, because a live region that
 * arrives together with its text is not announced reliably. A toast is then copied into the
 * region of the topmost modal dialog; its Undo runs the page's own Undo. The page's region is
 * untouched and is inert for as long as the dialog is open, so nothing is announced twice.
 */
const SOURCE = '[data-alpha-toast]';
const HOST = 'data-alpha-dialog-toast';

let installed: (() => void) | null = null;
/** Installed once per document; a second call returns the same uninstaller. */
export function installToastLayer(): () => void {
  if (installed) return installed;
  let frame = 0, undo: HTMLButtonElement | null = null;
  const modalOrder = new Set<HTMLDialogElement>();
  const modals = () => {
    for (const dialog of modalOrder) if (!dialog.isConnected || !dialog.matches('dialog[open]:modal')) modalOrder.delete(dialog);
    for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[open]:modal')) modalOrder.add(dialog);
    return [...modalOrder];
  };
  modals();
  const focused = document.activeElement?.closest<HTMLDialogElement>('dialog[open]:modal');
  if (focused) {
    modalOrder.delete(focused);
    modalOrder.add(focused);
  }
  const host = (dialog: HTMLDialogElement) => {
    let region = Array.from(dialog.children).find((child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute(HOST));
    if (region) return region;
    region = document.createElement('div');
    region.setAttribute(HOST, '');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    // Sticky: a dialog that scrolls its own content keeps the feedback in view at its top edge.
    region.style.cssText = 'position:sticky;top:0;z-index:1;order:-1;flex-shrink:0;margin:0;padding:0;border:0;background:transparent;color:inherit;display:flex;align-items:flex-start;justify-content:center;box-sizing:border-box;width:100%;max-height:calc(var(--alpha-visible-height,100dvh) * .3);overflow:auto';
    dialog.prepend(region);
    return region;
  };
  const sync = () => {
    frame = 0;
    const open = modals(), topmost = open.at(-1);
    for (const stale of document.querySelectorAll<HTMLElement>(`[${HOST}]`)) if (!open.includes(stale.parentElement as HTMLDialogElement)) stale.remove();
    if (!topmost) { undo = null; return; }
    const regions = open.map(host);
    const source = document.querySelector<HTMLElement>(SOURCE), shown = source?.firstElementChild as HTMLElement | null;
    const text = (shown?.querySelector('span')?.textContent ?? '').trim();
    undo = shown?.querySelector('button') ?? null;
    const signature = text ? `${text}\n${undo ? 'undo' : ''}` : '';
    for (const region of regions) {
      const wanted = region === regions.at(-1) ? signature : '';
      if ((region.dataset.alphaToastShown ?? '') === wanted) continue;
      region.dataset.alphaToastShown = wanted;
      region.replaceChildren();
      if (!wanted || !shown) continue;
      const paint = getComputedStyle(shown);
      const body = document.createElement('div');
      body.style.cssText = 'flex-shrink:0;pointer-events:auto;min-height:48px;max-width:100%;box-sizing:border-box;border-radius:24px;font:600 14px/1.35 "Public Sans",system-ui,sans-serif;display:flex;gap:14px;align-items:center;box-shadow:0 8px 24px rgba(0,0,0,.28)';
      body.style.background = paint.backgroundColor; body.style.color = paint.color;
      body.style.padding = undo ? '0 4px 0 18px' : '0 18px';
      const message = document.createElement('span');
      message.style.cssText = 'flex-grow:1;min-width:0;padding:8px 0;overflow-wrap:anywhere';
      message.textContent = text;
      body.append(message);
      if (undo) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = 'Undo';
        button.style.cssText = 'flex-shrink:0;min-height:40px;padding:0 14px;border:0;border-radius:20px;color:inherit;background:rgba(127,127,127,.28);font:inherit;font-weight:700';
        // The page's own Undo is inert under the dialog, not disabled: run it.
        button.addEventListener('click', () => { undo?.click(); });
        body.append(button);
      }
      region.append(body);
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
  const changes = new MutationObserver(records => {
    // Dialogs enter the browser top layer in open order, which can differ from document order.
    for (const record of records) {
      const dialog = record.target;
      if (record.attributeName === 'open' && record.oldValue === null &&
          dialog instanceof HTMLDialogElement && dialog.matches('dialog[open]:modal')) {
        modalOrder.delete(dialog);
        modalOrder.add(dialog);
      }
    }
    schedule();
  });
  changes.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['open'], attributeOldValue: true });
  window.addEventListener('resize', schedule);
  sync();
  const uninstall = () => {
    if (installed !== uninstall) return;
    installed = null;
    changes.disconnect(); window.removeEventListener('resize', schedule);
    if (frame) cancelAnimationFrame(frame);
    for (const region of document.querySelectorAll(`[${HOST}]`)) region.remove();
  };
  installed = uninstall;
  return uninstall;
}
