type FocusSnapshot = { root: HTMLElement; key: string; element: HTMLElement; moved: boolean; committed: boolean; release: () => void };

/** Retain a focused logical item when a committed render moves it between list parents. */
export function createKeyedListFocus(attribute: string) {
  let root: HTMLElement | null = null;
  let revision = 0;
  const hidden = (element: HTMLElement) => !element.getClientRects().length || !!element.closest('[inert],[hidden],[aria-hidden="true"]');
  return {
    capture(): FocusSnapshot | null {
      const element = document.activeElement;
      if (!root?.isConnected || document.hidden || hidden(root) || !(element instanceof HTMLElement) || !root.contains(element)) return null;
      const item = element.closest<HTMLElement>(`[${attribute}]`);
      const key = item?.getAttribute(attribute);
      if (!item || !root.contains(item) || !key) return null;
      const moved = (event: FocusEvent) => { if (event.target !== element) snapshot.moved = true; };
      const snapshot = {root, key, element, moved: false, committed: false,
        release: () => document.removeEventListener('focusin', moved, true)};
      document.addEventListener('focusin', moved, true);
      // A yielded or discarded render cannot later reclaim another control's focus.
      queueMicrotask(() => {
        if (!snapshot.committed) { snapshot.moved = true; snapshot.release(); }
      });
      return snapshot;
    },
    ref(snapshot: FocusSnapshot | null) {
      return (element: HTMLElement | null) => {
        root = element;
        const ticket = ++revision;
        if (!element || !snapshot || element !== snapshot.root) return;
        snapshot.committed = true;
        queueMicrotask(() => {
          snapshot.release();
          if (snapshot.moved || revision !== ticket || root !== element || !element.isConnected || document.hidden || hidden(element) || document.querySelector('dialog[open]')) return;
          const focused = document.activeElement;
          if (focused === snapshot.element || focused && focused !== document.body) return;
          const matches = Array.from(element.querySelectorAll<HTMLElement>(`[${attribute}]`))
            .filter(item => item.getAttribute(attribute) === snapshot.key);
          if (matches.length !== 1 || hidden(matches[0]) || matches[0].matches(':disabled')) return;
          matches[0].focus({preventScroll:true});
        });
      };
    },
  };
}
