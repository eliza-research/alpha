import type { Page } from '@playwright/test';

/**
 * Dependency-free accessibility checks for the renderer, in the spirit of axe rules.
 *
 * Names, roles and focusability come from Chromium's own accessibility tree (the tree
 * Android WebView hands to TalkBack is computed by the same engine), so there is no
 * second, approximate accessible-name implementation here. Geometry, contrast and
 * clipping are measured in the page.
 *
 * These are renderer checks only. They are not a TalkBack, Switch Access, physical
 * large-font or device rotation pass; those stay device acceptance (MVP-48).
 */
export type Violation = { rule: string; target: string; detail?: string };

const NAMED_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'slider',
  'spinbutton', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'listbox', 'dialog', 'alertdialog',
  'image', 'img', 'progressbar', 'meter', 'PopUpButton', 'ColorWell', 'DisclosureTriangle',
]);
const OPERABLE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'slider',
  'spinbutton', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'PopUpButton', 'DisclosureTriangle',
]);

type AxNode = {
  ignored?: boolean; role?: { value?: string }; name?: { value?: string }; backendDOMNodeId?: number;
  properties?: Array<{ name: string; value: { value?: unknown } }>;
};

/** Every exposed control, dialog and image has a name, and every exposed control takes focus. */
export async function auditTree(page: Page): Promise<Violation[]> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Accessibility.enable');
    const { nodes } = await session.send('Accessibility.getFullAXTree') as { nodes: AxNode[] };
    const out: Violation[] = [];
    const describe = async (node: AxNode) => {
      if (!node.backendDOMNodeId) return `<${node.role?.value}>`;
      try {
        const { object } = await session.send('DOM.resolveNode', { backendNodeId: node.backendDOMNodeId }) as { object: { objectId: string } };
        const { result } = await session.send('Runtime.callFunctionOn', {
          objectId: object.objectId, returnByValue: true,
          functionDeclaration: `function(){const el=this.nodeType===1?this:this.parentElement;if(!el)return '';const layer=el.closest('[data-alpha-subview],[data-alpha-layer],[data-screen],dialog,[role=dialog]');const where=layer?(layer.getAttribute('data-alpha-subview')||layer.getAttribute('data-alpha-layer')||layer.getAttribute('data-screen')||layer.getAttribute('aria-label')||layer.tagName.toLowerCase()):'';return (where?'['+where+'] ':'')+el.outerHTML.replace(/\\s+/g,' ').replace(/ style="[^"]*"/g,'').slice(0,180);}`,
        }) as { result: { value: string } };
        return result.value;
      } catch { return `<${node.role?.value}>`; }
    };
    for (const node of nodes) {
      if (node.ignored) continue;
      const role = node.role?.value || '';
      const properties = Object.fromEntries((node.properties || []).map(item => [item.name, item.value.value]));
      const name = String(node.name?.value || '').trim();
      if (NAMED_ROLES.has(role) && !name) out.push({ rule: 'accessible-name', target: await describe(node), detail: role });
      if (OPERABLE_ROLES.has(role) && !properties.disabled && properties.focusable !== true)
        out.push({ rule: 'keyboard-focusable', target: await describe(node), detail: role });
    }
    return out;
  } finally { await session.detach().catch(() => {}); }
}

export type PageAuditOptions = {
  /** Check text contrast against the composited background (WCAG 1.4.3). */
  contrast?: boolean;
  /** Check that text and controls are not clipped or pushed off the phone (WCAG 1.4.4, 1.4.10). */
  clipping?: boolean;
  /** Smallest pointer target in CSS pixels (WCAG 2.5.8 requires 24). */
  targetSize?: number;
  /**
   * Check that no two pieces of readable text and no two controls are painted over each other, and
   * that no control is cut through by a box that does not scroll (WCAG 1.4.4, 1.4.12). Measured from
   * bounding boxes after clipping; text or a control under an opaque layer is not counted.
   */
  overlap?: boolean;
  /**
   * Check the floating dock (the composer bar, the pill, the resting half sheet) and toasts:
   * on Home and in the app library nothing readable or operable may be painted under the dock at
   * all; in an app's own scroller a control or label under the dock must be reachable by scrolling
   * it fully clear; and a toast on screen must be painted on top and not be inert (a toast left
   * under a top-layer dialog is neither seen nor announced). Measured from bounding boxes after
   * clipping and from hit tests.
   */
  dock?: boolean;
};

/** Structure, keyboard operability, contrast and clipping measured in the page. */
export async function auditPage(page: Page, options: PageAuditOptions = {}): Promise<Violation[]> {
  return page.evaluate(({ contrast, clipping, targetSize, overlap, dock }) => {
    const out: Array<{ rule: string; target: string; detail?: string }> = [];
    const describe = (el: Element) => {
      const layer = el.closest('[data-alpha-subview],[data-alpha-layer],[data-screen],dialog,[role=dialog]');
      const where = layer ? (layer.getAttribute('data-alpha-subview') || layer.getAttribute('data-alpha-layer') || layer.getAttribute('data-screen') || layer.getAttribute('aria-label') || layer.tagName.toLowerCase()) : '';
      return (where ? `[${where}] ` : '') + el.outerHTML.replace(/\s+/g, ' ').replace(/ style="[^"]*"/g, '').slice(0, 180);
    };
    const shown = (el: Element) => {
      if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;
      if (!el.getClientRects().length) return false;
      // Chromium retains geometry inside closed <details>; those descendants are not painted.
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return false;
      const style = getComputedStyle(el);
      return style.visibility === 'visible' && style.display !== 'none';
    };
    const exposed = (el: Element) => shown(el) && !el.closest('[inert]');
    const INTERACTIVE = 'button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=switch],[role=tab],[role=menuitem],[role=radio],[role=slider],[role=option],[role=textbox],[role=searchbox],[role=combobox]';
    const TABBABLE = 'button,a[href],input:not([type=hidden]),select,textarea,summary,[tabindex],[contenteditable=""],[contenteditable=true]';
    const tabbable = (el: Element) => el.matches(TABBABLE) && !el.matches(':disabled,[tabindex="-1"]') && exposed(el);
    // A top-layer <dialog> or an open inline dialog owns the screen; only it is judged for geometry.
    const top = Array.from(document.querySelectorAll('dialog[open]')).at(-1) || null;
    const within = (el: Element) => !top || top.contains(el);
    // The map is a pannable surface: labels and pins outside the frame are reached by panning,
    // and every place is also listed in the results sheet.
    const PANNABLE = '[data-alpha-map-canvas],[data-alpha-map-plane]';
    const viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };

    // 1. Focus must never be able to enter content that assistive technology cannot see.
    for (const el of document.querySelectorAll('[aria-hidden="true"]'))
      for (const control of el.querySelectorAll(TABBABLE)) if (tabbable(control)) out.push({ rule: 'aria-hidden-focus', target: describe(control) });

    // 2. A click handler on an element that is not a control cannot be reached by keyboard,
    //    switch or TalkBack. Pointer-only scrims with no content of their own are allowed
    //    (their dialog must close another way; the keyboard sweep checks that).
    const handler = (el: Element) => {
      for (const key of Object.keys(el)) if (key.startsWith('__reactProps$')) return typeof (el as any)[key]?.onClick === 'function';
      return false;
    };
    for (const el of document.querySelectorAll('*')) {
      if (!handler(el) || !exposed(el) || el.closest('[aria-hidden="true"]')) continue;
      if (el.matches(INTERACTIVE) || el.closest(INTERACTIVE) || el.matches('label,dialog,form,[role=dialog],[role=alertdialog]')) continue;
      if (el.querySelector(INTERACTIVE)) continue;
      const own = (el.textContent || '').trim() || el.getAttribute('aria-label') || el.querySelector('img,svg');
      if (!own) continue;
      out.push({ rule: 'click-without-control', target: describe(el) });
    }

    // 3. References must resolve, and ids used by them must be unique.
    for (const el of document.querySelectorAll('[aria-labelledby],[aria-describedby],[aria-controls]')) {
      if (!exposed(el)) continue;
      for (const attribute of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
        for (const id of (el.getAttribute(attribute) || '').split(/\s+/).filter(Boolean)) {
          const matches = document.querySelectorAll(`[id="${CSS.escape(id)}"]`).length;
          if (matches !== 1 && !(attribute === 'aria-controls' && matches === 0)) out.push({ rule: 'aria-reference', target: describe(el), detail: `${attribute}=${id} resolves to ${matches}` });
        }
      }
    }

    // 4. Pointer targets.
    if (targetSize) for (const el of document.querySelectorAll(INTERACTIVE)) {
      if (!exposed(el) || !within(el) || el.closest('[aria-hidden="true"]') || el.matches(':disabled')) continue;
      // An inline link inside a sentence is exempt (WCAG 2.5.8 inline exception).
      if (el.matches('a[href]') && getComputedStyle(el).display.startsWith('inline')) continue;
      // A native checkbox, radio or range inside a label takes the label as its target.
      const subject = el.matches('input') && el.closest('label') ? el.closest('label')! : el;
      const rect = subject.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      if (rect.width < targetSize - .5 || rect.height < targetSize - .5) out.push({ rule: 'target-size', target: describe(el), detail: `${Math.round(rect.width)}x${Math.round(rect.height)}` });
    }

    // 5. Contrast of rendered text against whatever is painted behind it.
    if (contrast) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      const cache = new Map<string, number[]>();
      const rgba = (value: string) => {
        let parsed = cache.get(value);
        if (!parsed) {
          context.clearRect(0, 0, 1, 1); context.fillStyle = '#000'; context.fillStyle = value; context.fillRect(0, 0, 1, 1);
          const data = context.getImageData(0, 0, 1, 1).data; parsed = [data[0], data[1], data[2], data[3] / 255]; cache.set(value, parsed);
        }
        return parsed;
      };
      const opacity = (el: Element | null) => { let value = 1; for (let node = el; node; node = node.parentElement) value *= Number(getComputedStyle(node).opacity); return value; };
      const over = (top: number[], under: number[]) => { const a = top[3] + under[3] * (1 - top[3]); return a ? [0, 1, 2].map(i => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a) : [0, 0, 0, 0]; };
      const luminance = (color: number[]) => { const [r, g, b] = color.map(v => { const c = v / 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
      const seen = new Set<Element>();
      // Text that is fading or sliding in is judged once it has arrived, not mid-transition.
      const moving = document.getAnimations().filter(item => item.playState === 'running').map(item => (item.effect as KeyframeEffect | null)?.target).filter((target): target is Element => !!target);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement; const text = (node.nodeValue || '').trim();
        if (!el || !text || seen.has(el) || !shown(el) || !within(el)) continue;
        if (el.closest('script,style,noscript,[aria-disabled="true"],:disabled,option') || moving.some(target => target.contains(el))) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        const rect = Array.from(range.getClientRects()).find(item => item.width > 1 && item.height > 1);
        if (!rect) continue;
        const x = rect.left + Math.min(rect.width / 2, 6), y = rect.top + rect.height / 2;
        if (x < 0 || y < 0 || x >= viewport.width || y >= viewport.height) continue;
        const stack = document.elementsFromPoint(x, y);
        // Covered text is not what the user sees.
        if (!stack.length || !(stack[0] === el || el.contains(stack[0]) || stack[0].contains(el))) continue;
        const start = stack.indexOf(el); if (start < 0) continue;
        seen.add(el);
        const style = getComputedStyle(el);
        let background = [0, 0, 0, 0], unknown = false;
        for (const layer of stack.slice(start)) {
          const layerStyle = getComputedStyle(layer);
          if (layer.matches('img,video,canvas,picture,iframe') || (layer !== el && layer.matches('svg')) || layerStyle.backgroundImage !== 'none' || layerStyle.backdropFilter !== 'none' && layerStyle.backdropFilter) { unknown = true; break; }
          const color = rgba(layerStyle.backgroundColor); color[3] *= opacity(layer);
          background = over(background, color);
          if (background[3] >= .999) break;
        }
        // Text over imagery, gradients and blur is checked by the dedicated overlay specs.
        if (unknown) continue;
        background = over(background, [255, 255, 255, 1]);
        const ink = rgba(style.color).slice(); ink[3] *= opacity(el);
        const foreground = over(ink, background);
        const l1 = luminance(foreground), l2 = luminance(background);
        const ratio = (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
        const size = parseFloat(style.fontSize), bold = Number(style.fontWeight) >= 700;
        const needed = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
        if (ratio + .005 < needed) out.push({ rule: 'contrast', target: describe(el), detail: `${ratio.toFixed(2)}:1 < ${needed}:1 "${text.slice(0, 40)}" ${Math.round(size)}px` });
      }
    }

    // 6. Clipping: nothing readable may be cut off, and nothing may leave the phone sideways.
    if (clipping) {
      const scrolls = (el: Element, axis: 'x' | 'y') => { const value = getComputedStyle(el)[axis === 'x' ? 'overflowX' : 'overflowY']; return value === 'auto' || value === 'scroll'; };
      const scroller = (el: Element, axis: 'x' | 'y') => { for (let node = el.parentElement; node; node = node.parentElement) if (scrolls(node, axis) && (axis === 'x' ? node.scrollWidth > node.clientWidth : node.scrollHeight > node.clientHeight)) return node; return null; };
      const root = top || document.querySelector('.alpha-recovery') || document.querySelector('.os') || document.body;
      const bounds = root.getBoundingClientRect();
      const left = Math.max(0, bounds.left), right = Math.min(viewport.width, bounds.right);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const judged = new Set<Element>();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement; const text = (node.nodeValue || '').trim();
        if (!el || !text || judged.has(el) || !exposed(el) || el.closest('[aria-hidden="true"],script,style,option') || el.closest(PANNABLE)) continue;
        judged.add(el);
        const style = getComputedStyle(el);
        const range = document.createRange(); range.selectNodeContents(node);
        const rects = Array.from(range.getClientRects()).filter(item => item.width > 1 && item.height > 1);
        if (!rects.length) continue;
        // Text must stay inside every clipping ancestor, unless that ancestor scrolls to it.
        let freeX = false, freeY = false, hidden = false;
        for (let box: Element | null = el; box && box !== root.parentElement && !(freeX && freeY); box = box.parentElement) {
          const boxStyle = getComputedStyle(box);
          // Past a scroller, the user can bring the text into view on that axis.
          if (scrolls(box, 'x')) freeX = true;
          if (scrolls(box, 'y')) freeY = true;
          const clipX = !freeX && boxStyle.overflowX !== 'visible', clipY = !freeY && boxStyle.overflowY !== 'visible';
          if (!clipX && !clipY) continue;
          const frame = box.getBoundingClientRect();
          // Text wholly outside a clipping box is hidden, not cut; only a partial cut is illegible.
          if (rects.every(item => item.left >= frame.right - 1 || item.right <= frame.left + 1 || item.top >= frame.bottom - 1 || item.bottom <= frame.top + 1)) { hidden = true; break; }
          const cutX = clipX && rects.some(item => item.right > frame.right + 1.5 || item.left < frame.left - 1.5);
          const cutY = clipY && rects.some(item => item.bottom > frame.bottom + 2.5 || item.top < frame.top - 2.5);
          if (cutX || cutY) {
            // Deliberate single-line truncation keeps the full text available to assistive
            // technology; it is reported separately so it can be judged per surface.
            const ellipsis = cutX && !cutY && (style.textOverflow === 'ellipsis' || boxStyle.textOverflow === 'ellipsis' || style.webkitLineClamp !== 'none' && !!style.webkitLineClamp);
            const clamp = cutY && (boxStyle.webkitLineClamp !== 'none' && !!boxStyle.webkitLineClamp);
            out.push({ rule: ellipsis || clamp ? 'text-truncated' : 'text-clipped', target: describe(el), detail: `"${text.slice(0, 40)}" cut ${cutX ? 'horizontally' : 'vertically'} by ${box === el ? 'itself' : describe(box).slice(0, 80)}` });
            hidden = true; // already reported; the part beyond the box is not painted
            break;
          }
        }
        // Wrapped lines must not print over each other: a line box shorter than the text it holds
        // (a pixel line height under scaled text) overlaps the line above.
        const lineHeight = parseFloat(style.lineHeight), fontSize = parseFloat(style.fontSize);
        if (!hidden && lineHeight && lineHeight < fontSize * .95 && new Set(rects.map(item => Math.round(item.top))).size > 1)
          out.push({ rule: 'text-lines-overlap', target: describe(el), detail: `"${text.slice(0, 40)}" ${Math.round(fontSize)}px text on ${Math.round(lineHeight)}px lines` });
        // Text must not run off the side of the phone where no scroller can bring it back.
        if (!hidden && !scroller(el, 'x') && rects.some(item => item.right > right + 1.5 || item.left < left - 1.5))
          out.push({ rule: 'text-off-screen', target: describe(el), detail: `"${text.slice(0, 40)}"` });
      }
      for (const el of root.querySelectorAll(INTERACTIVE)) {
        if (!exposed(el) || el.closest('[aria-hidden="true"]') || el.closest(PANNABLE)) continue;
        const rect = el.getBoundingClientRect(); if (!rect.width || !rect.height) continue;
        if (!scroller(el, 'x') && (rect.right > right + 1.5 || rect.left < left - 1.5)) out.push({ rule: 'control-off-screen', target: describe(el), detail: `${Math.round(rect.left)}..${Math.round(rect.right)} outside ${Math.round(left)}..${Math.round(right)}` });
        // A label wider or taller than its own control spills onto its neighbours.
        if (getComputedStyle(el).overflow === 'visible' && !el.matches('input,textarea,select')) {
          const labels = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let node = labels.nextNode(); node; node = labels.nextNode()) {
            if (!(node.nodeValue || '').trim() || !node.parentElement || !shown(node.parentElement) || getComputedStyle(node.parentElement).position === 'absolute') continue;
            // Text clipped or truncated inside the control is judged by the clipping rules above.
            let inner = false; for (let box: Element | null = node.parentElement; box && box !== el; box = box.parentElement) if (getComputedStyle(box).overflow !== 'visible') { inner = true; break; }
            if (inner) continue;
            const range = document.createRange(); range.selectNodeContents(node);
            if (Array.from(range.getClientRects()).some(item => item.width > 1 && (item.right > rect.right + 2.5 || item.left < rect.left - 2.5 || item.bottom > rect.bottom + 3.5 || item.top < rect.top - 3.5))) {
              out.push({ rule: 'label-overflows-control', target: describe(el), detail: `"${(node.nodeValue || '').trim().slice(0, 40)}"` }); break;
            }
          }
        }
        // A control below or above the fold with no vertical scroller cannot be reached at all.
        if (!scroller(el, 'y') && (rect.top > viewport.height - 1 || rect.bottom < 1) && getComputedStyle(el).position !== 'fixed') out.push({ rule: 'control-unreachable', target: describe(el), detail: `top ${Math.round(rect.top)} in ${viewport.height}` });
      }
    }
    // 7. Overlap: readable text must not be printed over other readable text, a control must not
    //    sit on another control, and a control must not be cut through by a box that cannot scroll.
    if (overlap) {
      type Box = { left: number; top: number; right: number; bottom: number };
      const root = top || document.querySelector('.alpha-recovery') || document.querySelector('.os') || document.body;
      const scrolls = (value: string) => value === 'auto' || value === 'scroll';
      // What is left of a box once every clipping ancestor and the viewport have cut it.
      const painted = (rect: Box, el: Element): Box | null => {
        const box = { left: Math.max(0, rect.left), top: Math.max(0, rect.top), right: Math.min(viewport.width, rect.right), bottom: Math.min(viewport.height, rect.bottom) };
        for (let node: Element | null = el; node && node !== document.documentElement; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (Number(style.opacity) < .05) return null;
          if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
          const frame = node.getBoundingClientRect();
          if (style.overflowX !== 'visible') { box.left = Math.max(box.left, frame.left); box.right = Math.min(box.right, frame.right); }
          if (style.overflowY !== 'visible') { box.top = Math.max(box.top, frame.top); box.bottom = Math.min(box.bottom, frame.bottom); }
        }
        return box.right - box.left > 1 && box.bottom - box.top > 1 ? box : null;
      };
      // Hit testing skips pointer-events:none content; for the duration of the measurement
      // everything is hit-testable so the paint order of any two boxes can be read.
      const probe = document.createElement('style'); probe.textContent = '*{pointer-events:auto!important}'; document.head.append(probe);
      try {
        const opaque = (el: Element) => {
          const style = getComputedStyle(el);
          if (el.matches('img,video,canvas,picture,iframe') || style.backgroundImage !== 'none') return true;
          const match = style.backgroundColor.match(/rgba?\(([^)]+)\)/);
          const parts = match ? match[1].split(/[,\s/]+/).filter(Boolean).map(Number) : [];
          return parts.length >= 3 && (parts.length < 4 || parts[3] >= .5);
        };
        // Both boxes are painted where they meet: neither is behind an opaque layer of the other's stack.
        const together = (a: Element, b: Element, x: number, y: number) => {
          const stack = document.elementsFromPoint(x, y);
          const first = stack.indexOf(a), second = stack.indexOf(b);
          if (first < 0 || second < 0) return false;
          for (let index = Math.min(first, second); index < Math.max(first, second); index++) if (opaque(stack[index])) return false;
          return true;
        };
        const meet = (a: Box, b: Box) => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });

        // Text. A line's box is reduced to its em box (font size, centred): line boxes of adjacent
        // lines overlap by design wherever the line height is below the font's content area.
        const runs: Array<{ el: Element; text: string; size: number; box: Box }> = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const el = node.parentElement; const text = (node.nodeValue || '').trim();
          if (!el || !text || !exposed(el) || el.closest('[aria-hidden="true"],script,style,option') || el.closest(PANNABLE)) continue;
          const size = parseFloat(getComputedStyle(el).fontSize) || 0;
          const range = document.createRange(); range.selectNodeContents(node);
          for (const rect of Array.from(range.getClientRects())) {
            if (rect.width <= 1 || rect.height <= 1) continue;
            const trim = Math.max(0, (rect.height - size) / 2);
            const box = painted({ left: rect.left, right: rect.right, top: rect.top + trim, bottom: rect.bottom - trim }, el);
            if (box) runs.push({ el, text, size, box });
          }
        }
        const reported = new Set<string>();
        const key = (a: Element, b: Element) => `${describe(a)}\n${describe(b)}`;
        for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
          const a = runs[i], b = runs[j];
          if (a.el === b.el) continue;
          const shared = meet(a.box, b.box);
          if (shared.right - shared.left <= 2 || shared.bottom - shared.top <= Math.max(2, .15 * Math.min(a.size, b.size))) continue;
          if (!together(a.el, b.el, (shared.left + shared.right) / 2, (shared.top + shared.bottom) / 2)) continue;
          const id = key(a.el, b.el); if (reported.has(id)) continue; reported.add(id);
          out.push({ rule: 'text-overlap', target: describe(a.el), detail: `"${a.text.slice(0, 30)}" is printed over "${b.text.slice(0, 30)}" (${Math.round(shared.right - shared.left)}x${Math.round(shared.bottom - shared.top)})` });
        }

        // A short word in a control's label that is split across lines reads as two fragments
        // ("Calenda" / "r"): the label needed more room than its control gave it.
        for (const el of root.querySelectorAll(INTERACTIVE)) {
          if (!exposed(el) || el.closest('[aria-hidden="true"]') || el.closest(PANNABLE) || el.matches('input,textarea,select')) continue;
          const labels = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let broken = '';
          for (let node = labels.nextNode(); node && !broken; node = labels.nextNode()) {
            if (!node.parentElement || !shown(node.parentElement)) continue;
            const value = node.nodeValue || '';
            for (const word of value.matchAll(/[\p{L}\p{N}]{2,14}/gu)) {
              // Only whole words: a fragment of a longer unbroken string (an address, a file name) is content, not a label.
              const before = value[word.index! - 1], after = value[word.index! + word[0].length];
              if ((before && !/\s/.test(before)) || (after && !/[\s.,:;!?…]/.test(after))) continue;
              const range = document.createRange(); range.setStart(node, word.index!); range.setEnd(node, word.index! + word[0].length);
              const lines = Array.from(range.getClientRects()).filter(item => item.width > 1 && item.height > 1 && painted(item, node.parentElement!));
              if (new Set(lines.map(item => Math.round(item.top))).size > 1) { broken = word[0]; break; }
            }
          }
          if (broken) out.push({ rule: 'label-word-broken', target: describe(el), detail: `"${broken}" is split across lines` });
        }

        // Controls.
        const controls: Array<{ el: Element; box: Box }> = [];
        for (const el of root.querySelectorAll(INTERACTIVE)) {
          if (!exposed(el) || el.closest('[aria-hidden="true"]') || el.closest(PANNABLE)) continue;
          const rect = el.getBoundingClientRect(); if (!rect.width || !rect.height) continue;
          const box = painted(rect, el.parentElement || el);
          if (!box) continue;
          const cutX = Math.max(box.left - rect.left, rect.right - box.right), cutY = Math.max(box.top - rect.top, rect.bottom - box.bottom);
          // Cut by a box the user cannot scroll: part of the control is not painted and cannot be brought back.
          let scrollable = false;
          for (let node = el.parentElement; node; node = node.parentElement) { const style = getComputedStyle(node); if ((scrolls(style.overflowX) && node.scrollWidth > node.clientWidth) || (scrolls(style.overflowY) && node.scrollHeight > node.clientHeight)) { scrollable = true; break; } }
          const inside = rect.left >= -1 && rect.top >= -1 && rect.right <= viewport.width + 1 && rect.bottom <= viewport.height + 1;
          if (!scrollable && inside && (cutX > 2.5 || cutY > 2.5)) out.push({ rule: 'control-clipped', target: describe(el), detail: `${Math.round(Math.max(cutX, cutY))}px of ${Math.round(rect.width)}x${Math.round(rect.height)} is cut off` });
          controls.push({ el, box });
        }
        for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
          const a = controls[i], b = controls[j];
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          // A label and the native control it wraps, or a field and the affordance drawn inside it, are one target.
          if (a.el.matches('input,textarea,select') || b.el.matches('input,textarea,select')) continue;
          const shared = meet(a.box, b.box);
          if (shared.right - shared.left <= 4 || shared.bottom - shared.top <= 4) continue;
          if (!together(a.el, b.el, (shared.left + shared.right) / 2, (shared.top + shared.bottom) / 2)) continue;
          out.push({ rule: 'control-overlap', target: describe(a.el), detail: `shares ${Math.round(shared.right - shared.left)}x${Math.round(shared.bottom - shared.top)} with ${describe(b.el).slice(0, 100)}` });
        }
      } finally { probe.remove(); }
    }
    // 8. The floating dock and toasts.
    if (dock) {
      type Box = { left: number; top: number; right: number; bottom: number };
      const scrolls = (value: string) => value === 'auto' || value === 'scroll';
      const painted = (rect: Box, el: Element): Box | null => {
        const box = { left: Math.max(0, rect.left), top: Math.max(0, rect.top), right: Math.min(viewport.width, rect.right), bottom: Math.min(viewport.height, rect.bottom) };
        for (let node: Element | null = el; node && node !== document.documentElement; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (Number(style.opacity) < .05) return null;
          if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
          const frame = node.getBoundingClientRect();
          if (style.overflowX !== 'visible') { box.left = Math.max(box.left, frame.left); box.right = Math.min(box.right, frame.right); }
          if (style.overflowY !== 'visible') { box.top = Math.max(box.top, frame.top); box.bottom = Math.min(box.bottom, frame.bottom); }
        }
        return box.right - box.left > 1 && box.bottom - box.top > 1 ? box : null;
      };
      // The dock is whichever of these is on screen: the composer bar with anything stacked on
      // it, the pill, or the conversation sheet resting over the lower part of the page.
      const DOCK = '[data-alpha-layer="composer"],[data-alpha-layer="pill"] > *,[data-alpha-layer="conversation"]';
      const docks = top ? [] : Array.from(document.querySelectorAll(DOCK)).filter(el => exposed(el) && !el.closest('[aria-hidden="true"]'))
        .map(el => ({ el, box: el.getBoundingClientRect() })).filter(item => item.box.width > 1 && item.box.height > 1);
      // Only the page the dock floats over is judged; menus, sheets, the shade and toasts are drawn above it.
      const UNDER = '[data-alpha-layer="home"],[data-alpha-layer="drawer"],[data-alpha-layer="app"]';
      const scale = (() => { const screen = document.querySelector<HTMLElement>('[data-screen]'); return screen && screen.offsetWidth ? screen.getBoundingClientRect().width / screen.offsetWidth : 1; })();
      const judge = (el: Element, rect: Box, what: string) => {
        const layer = el.closest(UNDER); if (!layer || !docks.length) return;
        const box = painted(rect, el.parentElement || el); if (!box) return;
        for (const item of docks) {
          const width = Math.min(box.right, item.box.right) - Math.max(box.left, item.box.left), height = Math.min(box.bottom, item.box.bottom) - Math.max(box.top, item.box.top);
          if (width <= 2 || height <= 2) continue;
          // The dock really is what is painted there (an inline dialog or a sheet above both is not the dock's doing).
          const hit = document.elementFromPoint(Math.max(box.left, item.box.left) + width / 2, Math.max(box.top, item.box.top) + height / 2);
          if (!hit || !(item.el === hit || item.el.contains(hit))) continue;
          // Floating docks intentionally cover scroll content. Every covered
          // control must have enough remaining scroll range to clear them.
          let room = 0;
          for (let node = el.parentElement; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (scrolls(style.overflowY) && node.scrollHeight > node.clientHeight) { room = (node.scrollHeight - node.clientHeight - node.scrollTop) * scale; break; }
          }
          const need = rect.bottom - item.box.top;
          if (room + 1 < need) out.push({ rule: 'obscured-by-dock', target: describe(el), detail: `${what} has ${Math.round(width)}x${Math.round(height)} under ${item.el.getAttribute('data-alpha-layer') || item.el.parentElement?.getAttribute('data-alpha-layer')}, and only ${Math.round(room)}px of the ${Math.round(need)}px needed can be scrolled` });
          return;
        }
      };
      if (docks.length) {
        for (const el of document.querySelectorAll(INTERACTIVE)) {
          if (!exposed(el) || el.closest('[aria-hidden="true"]') || el.closest(PANNABLE) || el.matches(':disabled')) continue;
          const rect = el.getBoundingClientRect(); if (rect.width && rect.height) judge(el, rect, 'control');
        }
        const seen = new Set<Element>();
        const walker = document.createTreeWalker(document.querySelector('.os') || document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const el = node.parentElement; const text = (node.nodeValue || '').trim();
          if (!el || !text || seen.has(el) || !exposed(el) || el.closest('[aria-hidden="true"],script,style,option') || el.closest(PANNABLE) || el.closest(INTERACTIVE)) continue;
          seen.add(el);
          const range = document.createRange(); range.selectNodeContents(node);
          for (const rect of Array.from(range.getClientRects())) if (rect.width > 1 && rect.height > 1) judge(el, rect, `"${text.slice(0, 30)}"`);
        }
      }
      // A toast on screen is the topmost thing where it is drawn, and assistive technology can
      // reach it: under a top-layer dialog it would be covered and inert, so never announced.
      for (const el of document.querySelectorAll('[data-alpha-toast],[data-alpha-dialog-toast]')) {
        const text = (el.textContent || '').trim(); if (!text || !shown(el)) continue;
        const mirrored = el.matches('[data-alpha-toast]') && Array.from(document.querySelectorAll('[data-alpha-dialog-toast]')).some(copy => shown(copy) && (copy.textContent || '').trim() === text);
        if (mirrored) continue;
        const body = el.firstElementChild || el, box = body.getBoundingClientRect();
        const modal = Array.from(document.querySelectorAll('dialog[open]')).filter(item => item.matches(':modal')).at(-1);
        if (el.closest('[inert]') || (modal && !modal.contains(el))) { out.push({ rule: 'toast-not-announced', target: describe(el), detail: `"${text.slice(0, 40)}" is inert${modal ? ' under a modal dialog' : ''}` }); continue; }
        const hit = box.width > 1 && box.height > 1 ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) : null;
        // pointer-events:none wrappers are skipped by hit testing; the toast body takes pointer events.
        if (!hit || !(body === hit || body.contains(hit) || hit.contains(body) && el.contains(hit))) out.push({ rule: 'toast-covered', target: describe(el), detail: `"${text.slice(0, 40)}" is under ${hit ? describe(hit).slice(0, 80) : 'nothing painted'}` });
      }
    }
    return out;
  }, { contrast: !!options.contrast, clipping: !!options.clipping, targetSize: options.targetSize || 0, overlap: !!options.overlap, dock: !!options.dock });
}

/** The accessible name of the one semantic group that holds the floating assistant controls. */
export const ASSISTANT_GROUP = 'Assistant controls';
/** Roles Android exposes as clickable or checkable nodes; their children are part of their label. */
const ANDROID_ACTIONABLE = new Set([
  'button', 'ToggleButton', 'PopUpButton', 'DisclosureTriangle', 'link', 'checkbox', 'radio', 'switch', 'tab',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'textbox', 'searchbox', 'combobox', 'slider', 'spinbutton',
]);
type AxTreeNode = AxNode & { nodeId: string; childIds?: string[]; parentId?: string };
type ReadGeometry = { box: { left: number; top: number; right: number; bottom: number }; live: boolean; where: string; group: number; surface: boolean };
/**
 * Bars of controls read in one order in every layout. An app header keeps the navigation, title,
 * actions order of an Android toolbar when a large system font moves its title to a row of its own
 * below the buttons (Material's large top app bar is read the same way), and the camera's capture
 * row keeps its portrait order when landscape turns it into a rail that runs upward, as the device
 * itself turned. Order is judged between bars and the rest of the screen, not inside one bar.
 */
export const READING_GROUPS = '[data-alpha-app-header],[data-alpha-camera="capture"]';

/**
 * TalkBack's linear reading order, the check AccessibilityInstrumentedTest.talkBackOrder makes on
 * Android, made in Chromium so that every view and state of the sweep gets it.
 *
 * Android WebView builds its node tree from the same Blink accessibility tree that CDP returns.
 * The walk follows that tree in order and keeps what Android exposes as a node TalkBack visits: a
 * control (its children are part of its label), a heading, focusable element or element with only
 * text inside it (Chromium drops their children on Android and reads their text as one node), and
 * remaining text and named images. For each visible node, by the bounds left after clipping:
 *
 * - `reading-order`: the next node must not sit above the previous one by more than half the
 *   taller of the two, unless it starts a new column to the right (the Android rule, unchanged);
 * - `assistant-group-order`: the floating assistant controls form one group, read last, so no
 *   app content may follow it (it floats above the bottom edge, so moving into it may go up);
 * - `assistant-group-duplicate`: at most one such group is exposed.
 *
 * Live regions (toasts, status lines) are announced when they change, not found by reading on,
 * so their place in the order is not judged; nor is order inside one bar of controls
 * (READING_GROUPS), or among the names painted on the pannable map. The conversation sheet floats
 * over the app like the dock and is judged like it. Content outside the phone screen (the browser
 * preview's rail) is not on a phone. These are renderer checks: TalkBack itself, Switch Access and
 * WebView's own node exposure remain emulator and device evidence (AccessibilityInstrumentedTest).
 */
export async function auditReadingOrder(page: Page): Promise<Violation[]> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Accessibility.enable');
    const { nodes } = await session.send('Accessibility.getFullAXTree') as { nodes: AxTreeNode[] };
    const byId = new Map(nodes.map(node => [node.nodeId, node]));
    const root = nodes.find(node => !node.parentId || !byId.has(node.parentId));
    if (!root) return [];
    const role = (node: AxTreeNode) => String(node.role?.value || '');
    const name = (node: AxTreeNode) => String(node.name?.value || '').trim();
    const property = (node: AxTreeNode, key: string) => (node.properties || []).find(item => item.name === key)?.value.value;
    const children = (node: AxTreeNode) => (node.childIds || []).map(id => byId.get(id)).filter((child): child is AxTreeNode => !!child);
    const exposedChildren = (node: AxTreeNode): AxTreeNode[] => children(node).flatMap(child => child.ignored ? exposedChildren(child) : [child]);
    const text = (node: AxTreeNode): string => role(node) === 'StaticText' ? name(node) : exposedChildren(node).map(text).filter(Boolean).join(' ');
    const focusableBelow = (node: AxTreeNode): boolean => exposedChildren(node).some(child => (property(child, 'focusable') === true && role(child) !== 'option') || focusableBelow(child));
    // BrowserAccessibilityAndroid::IsLeaf: which nodes Android reads as one node with their text.
    const leaf = (node: AxTreeNode) => {
      const kind = role(node);
      if (ANDROID_ACTIONABLE.has(kind) || kind === 'image' || kind === 'img' || kind === 'StaticText') return true;
      if (focusableBelow(node)) return false;
      if ((kind === 'heading' || property(node, 'focusable') === true) && text(node)) return true;
      const list = exposedChildren(node);
      return list.length > 0 && list.every(child => role(child) === 'StaticText');
    };
    type Visit = { node: AxTreeNode; label: string; assistant: boolean; order: number };
    const visits: Visit[] = []; let groups = 0;
    const walk = (node: AxTreeNode, assistant: boolean) => {
      if (node.ignored) { for (const child of children(node)) walk(child, assistant); return; }
      const kind = role(node);
      const group = kind === 'group' && name(node) === ASSISTANT_GROUP;
      if (group) groups++;
      const inside = assistant || group;
      if (leaf(node)) {
        const label = name(node) || text(node);
        if (ANDROID_ACTIONABLE.has(kind) || label) visits.push({ node, label, assistant: inside, order: visits.length });
        return;
      }
      for (const child of children(node)) walk(child, inside);
    };
    walk(root, false);
    const out: Violation[] = [];
    if (groups > 1) out.push({ rule: 'assistant-group-duplicate', target: `${groups} groups named "${ASSISTANT_GROUP}"` });
    // Geometry from the page: each node resolved once, all measured in one call.
    const resolved: Array<{ visit: Visit; objectId: string }> = [];
    for (const visit of visits) {
      if (!visit.node.backendDOMNodeId) continue;
      try {
        const { object } = await session.send('DOM.resolveNode', { backendNodeId: visit.node.backendDOMNodeId }) as { object: { objectId?: string } };
        if (object.objectId) resolved.push({ visit, objectId: object.objectId });
      } catch { /* detached while reading */ }
    }
    if (!resolved.length) return out;
    const { result } = await session.send('Runtime.callFunctionOn', {
      objectId: resolved[0].objectId, returnByValue: true, arguments: [{ value: READING_GROUPS }, ...resolved.map(item => ({ objectId: item.objectId }))],
      functionDeclaration: `function(groups,...nodes){
        const out=[],ids=new Map();
        for(const node of nodes){
          const el=node&&node.nodeType===1?node:node&&node.parentElement;
          if(!el||!el.isConnected){out.push(null);continue;}
          // The phone screen and what is drawn over it in the top layer. A shell without the phone
          // frame (the shared upstream shell) is judged whole, never skipped.
          const framed=!!document.querySelector('[data-screen]');
          const screen=!framed||el.closest('[data-screen]')||el.closest('dialog[open],:popover-open');
          // Names painted on the pannable map have a place, not an order; its pins are also listed in the results sheet.
          if(!screen||el.closest('[inert],[aria-hidden="true"]')||el.closest('[data-alpha-map-canvas],[data-alpha-map-plane]')){out.push(null);continue;}
          let rect;
          if(node.nodeType===3){const range=document.createRange();range.selectNodeContents(node);rect=range.getBoundingClientRect();}else rect=el.getBoundingClientRect();
          const box={left:Math.max(0,rect.left),top:Math.max(0,rect.top),right:Math.min(innerWidth,rect.right),bottom:Math.min(innerHeight,rect.bottom)};
          for(let p=el.parentElement;p&&p!==document.documentElement;p=p.parentElement){
            const s=getComputedStyle(p);if(s.overflowX==='visible'&&s.overflowY==='visible')continue;
            const f=p.getBoundingClientRect();
            if(s.overflowX!=='visible'){box.left=Math.max(box.left,f.left);box.right=Math.min(box.right,f.right);}
            if(s.overflowY!=='visible'){box.top=Math.max(box.top,f.top);box.bottom=Math.min(box.bottom,f.bottom);}
          }
          if(box.right-box.left<1||box.bottom-box.top<1){out.push(null);continue;}
          const live=!!el.closest('[aria-live]:not([aria-live="off"]),[role=status],[role=alert],[role=log],[role=timer],[role=marquee]');
          const layer=el.closest('[data-alpha-subview],[data-alpha-layer],[data-screen],dialog,[role=dialog]');
          const where=layer?(layer.getAttribute('data-alpha-subview')||layer.getAttribute('data-alpha-layer')||(layer.hasAttribute('data-screen')?'screen':'')||layer.getAttribute('aria-label')||layer.tagName.toLowerCase()):'';
          // A bar of controls is read in its own order in every layout (see GROUPS).
          const bar=el.closest(groups);let group=0;
          if(bar){if(!ids.has(bar))ids.set(bar,ids.size+1);group=ids.get(bar);}
          // The conversation sheet floats over the app like the dock: it is read after the app, and moving into it may go up.
          const surface=!!el.closest('[data-alpha-layer="conversation"]');
          out.push({box,live,where,group,surface});
        }
        return out;
      }`,
    }) as { result: { value: Array<ReadGeometry | null> } };
    const placed = resolved.map((item, index) => ({ ...item.visit, geometry: result.value[index] }))
      .filter((item): item is Visit & { geometry: ReadGeometry } => !!item.geometry && !item.geometry.live)
      .map(item => ({ ...item, assistant: item.assistant || item.geometry.surface }))
      .sort((a, b) => a.order - b.order);
    const describe = (item: { label: string; node: AxTreeNode; geometry: ReadGeometry }) => `${item.geometry.where ? `[${item.geometry.where}] ` : ''}${role(item.node)} '${item.label.slice(0, 60)}'`;
    let previous: (typeof placed)[number] | null = null, seenAssistant = false, reported = false;
    for (const item of placed) {
      if (seenAssistant && !item.assistant && !reported) { reported = true; out.push({ rule: 'assistant-group-order', target: describe(item), detail: `read after the "${ASSISTANT_GROUP}" group` }); }
      seenAssistant ||= item.assistant;
      if (previous && previous.assistant === item.assistant && !(item.geometry.group && item.geometry.group === previous.geometry.group)) {
        const p = previous.geometry.box, r = item.geometry.box;
        const tallest = Math.max(p.bottom - p.top, r.bottom - r.top);
        if (r.top < p.top - tallest / 2 && r.left < p.right)
          out.push({ rule: 'reading-order', target: describe(item), detail: `goes up from ${describe(previous)} (${Math.round(p.top)} to ${Math.round(r.top)})` });
      }
      previous = item;
    }
    return out;
  } finally { await session.detach().catch(() => {}); }
}

/**
 * Walk the tab order. Focus must move on every press, must never land in content hidden from
 * assistive technology, and must return to where it began (no trap, no dead end). A modal
 * dialog with a single control keeps focus on it by design; its dismissal is covered by the
 * dialog specs. Outside a modal, the walk must also reach every exposed tab stop: an order
 * that cycles through part of the page leaves the rest unreachable by keyboard. While a menu
 * or sheet is open over a scrim, no stop may sit under the scrim or the panel.
 */
export async function auditTabOrder(page: Page, limit = 120): Promise<Violation[]> {
  const read = () => page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return { key: 'body', hidden: false, visible: true, behind: false, under: '', modal: false, stops: 0, segmented: false, text: 'body' };
    const anyEl = el as any; anyEl.__alphaTabId ||= Math.random().toString(36).slice(2);
    const rect = el.getBoundingClientRect();
    const dialog = el.closest('dialog,[role=dialog],[role=alertdialog]');
    const stops = dialog ? Array.from(dialog.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,summary,[tabindex]'))
      .filter(item => !item.matches(':disabled,[tabindex="-1"]') && !item.closest('[inert]') && item.getClientRects().length > 0).length : 0;
    // A scrim is an empty button laid over (nearly) the whole phone to close a menu or sheet.
    // Focus on a control under it, or under the panel that follows it, is focus the user cannot
    // see on a control a pointer cannot reach: the popup must take the page out of the tab order.
    const phone = (document.querySelector('.os') || document.documentElement).getBoundingClientRect();
    const scrim = Array.from(document.querySelectorAll('button')).find(item => {
      if (item === el || item.contains(el) || (item.textContent || '').trim() || item.closest('[inert]') || !item.getClientRects().length) return false;
      const box = item.getBoundingClientRect();
      return box.width * box.height >= phone.width * phone.height * .8;
    });
    const hit = scrim ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
    const behind = !!scrim && !!hit && hit !== el && !el.contains(hit) && !hit.contains(el) && (hit === scrim || !!(scrim.compareDocumentPosition(hit) & Node.DOCUMENT_POSITION_FOLLOWING));
    // The focused control must be wholly visible: no part of it under the floating dock (the
    // composer bar, the pill or the resting sheet). Its painted box is what clipping leaves of it.
    let under = '';
    // A focusable scroll region is the scroller itself: it runs under the dock by design and its
    // content is scrolled clear, which the obscured-by-dock rule of auditPage judges.
    const region = ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) || el.matches('canvas.maplibregl-canvas[role=region]') && !!el.closest('[data-alpha-map-plane]');
    // The map is a keyboard-pannable region beneath floating controls. Its marker and buttons
    // are still checked individually; the canvas viewport itself intentionally fills the view.
    if (!region && !el.closest('[data-alpha-layer="composer"],[data-alpha-layer="pill"],[data-alpha-layer="conversation"],dialog')) {
      const box = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
        const style = getComputedStyle(node); if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
        const frame = node.getBoundingClientRect();
        if (style.overflowX !== 'visible') { box.left = Math.max(box.left, frame.left); box.right = Math.min(box.right, frame.right); }
        if (style.overflowY !== 'visible') { box.top = Math.max(box.top, frame.top); box.bottom = Math.min(box.bottom, frame.bottom); }
      }
      for (const dock of document.querySelectorAll('[data-alpha-layer="composer"],[data-alpha-layer="pill"] > *,[data-alpha-layer="conversation"]')) {
        if (dock.closest('[inert],[aria-hidden="true"]') || !dock.getClientRects().length) continue;
        const frame = dock.getBoundingClientRect();
        const width = Math.min(box.right, frame.right) - Math.max(box.left, frame.left), height = Math.min(box.bottom, frame.bottom) - Math.max(box.top, frame.top);
        if (width <= 2 || height <= 2) continue;
        const over = document.elementFromPoint(Math.max(box.left, frame.left) + width / 2, Math.max(box.top, frame.top) + height / 2);
        if (over && (dock === over || dock.contains(over))) under = `${Math.round(width)}x${Math.round(height)} under ${dock.getAttribute('data-alpha-layer') || dock.parentElement?.getAttribute('data-alpha-layer')}`;
      }
    }
    return {
      key: anyEl.__alphaTabId as string, hidden: !!el.closest('[inert],[aria-hidden="true"]'),
      visible: rect.width > 0 && rect.height > 0, behind, under, modal: !!dialog, stops,
      // Tab steps through the hour, minute and period fields of a native date or time input before leaving it.
      segmented: el.matches('input[type=time],input[type=date],input[type=datetime-local],input[type=month],input[type=week]'), text: el.outerHTML.replace(/\s+/g, ' ').replace(/ style="[^"]*"/g, '').slice(0, 140),
    };
  });
  const out: Violation[] = [];
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    for (const el of document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,summary,[tabindex]')) (el as any).__alphaTabCandidate = true;
  });
  const order: string[] = []; let previous = 'start', stuck = 0, wrapped = false, contained = false, edges = 0, idle = 0;
  for (let step = 0; step < limit; step++) {
    await page.keyboard.press('Tab');
    const current = await read();
    if (current.hidden) out.push({ rule: 'focus-in-hidden-content', target: current.text });
    if (!current.visible && current.key !== 'body') out.push({ rule: 'focus-not-visible', target: current.text });
    if (current.behind) out.push({ rule: 'focus-behind-scrim', target: current.text });
    if (current.under) out.push({ rule: 'focus-obscured', target: current.text, detail: current.under });
    if (current.key === previous && current.key !== 'body') { if (++stuck >= (current.segmented ? 8 : 2)) { if (!current.modal || current.stops > 1) out.push({ rule: 'focus-trap', target: current.text }); break; } } else stuck = 0;
    previous = current.key;
    if (stuck) continue;
    if (current.key !== 'body' && order.includes(current.key)) { wrapped = true; break; }
    if (current.key !== 'body') { order.push(current.key); contained ||= current.modal; }
    // Leaving the last stop passes through the browser's own controls. The walk starts wherever
    // focus was (a newly opened subview takes it), so it carries on past the edge until a stop
    // repeats: the stops before the starting point are part of the order too.
    else if (order.length ? ++edges > 1 : ++idle > 3) { wrapped = true; break; }
  }
  if (!wrapped && order.length >= limit - 1) out.push({ rule: 'focus-order-unbounded', target: `more than ${limit} tab stops` });
  // A dialog legitimately keeps focus to itself. Anywhere else, a completed cycle must have
  // visited every exposed tab stop. Radio groups share one stop, so radios are not counted.
  // A walk that never leaves the page body is a completed cycle of no stops: if Tab is swallowed,
  // every control on the page is unreachable by keyboard and is reported here.
  // Only controls that were on screen before the walk and are still there count: content that
  // arrives on a timer while the walk is under way is not a stop the walk skipped.
  if (wrapped && !contained) {
    const missed = await page.evaluate(() => Array.from(document.querySelectorAll('button,a[href],input:not([type=hidden]):not([type=radio]),select,textarea,summary,[tabindex]'))
      .filter(el => {
        if ((el as any).__alphaTabId || !(el as any).__alphaTabCandidate || el.matches(':disabled,[tabindex="-1"]') || el.closest('[inert],[aria-hidden="true"]') || !el.getClientRects().length) return false;
        const closed = el.closest('details:not([open])'); if (closed && !(el.matches('summary') && el.parentElement === closed)) return false;
        return getComputedStyle(el).visibility === 'visible';
      }).map(el => el.outerHTML.replace(/\s+/g, ' ').replace(/ style="[^"]*"/g, '').slice(0, 140)));
    for (const target of missed) out.push({ rule: 'focus-order-incomplete', target });
  }
  return out;
}

export function format(violations: Violation[]) {
  const seen = new Set<string>();
  return violations.filter(item => { const key = `${item.rule}|${item.target}|${item.detail || ''}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .map(item => `${item.rule}: ${item.target}${item.detail ? `  (${item.detail})` : ''}`);
}
