/** MapLibre paint colors are concrete values, not CSS variable expressions. Resolve against
 * this connected host on each construction/retry; never cache a previous theme's palette. */
export function resolveMapColors(container: HTMLElement, colors: Record<string, string>): Record<string, string> {
 const document = container.ownerDocument, view = document.defaultView;
 if (!container.isConnected || !view) throw new Error('Map theme colors are unavailable.');
 const hostStyle = view.getComputedStyle(container);
 const probe = document.createElement('span');
 probe.hidden = true;
 probe.setAttribute('aria-hidden', 'true');
 container.appendChild(probe);
 try {
  return Object.fromEntries(Object.entries(colors).map(([key, input]) => {
   let value = input.trim();
   const visited = new Set<string>();
   for (let depth = 0; value.includes('var('); depth++) {
    const token = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value)?.[1];
    if (!token || visited.has(token) || depth >= 16) throw new Error('Map theme colors are unavailable.');
    visited.add(token);
    value = hostStyle.getPropertyValue(token).trim();
    if (!value) throw new Error('Map theme colors are unavailable.');
   }
   // Clear first: CSS keeps its previous value when an invalid assignment is ignored.
   probe.style.color = '';
   probe.style.setProperty('color', value, 'important');
   if (!probe.style.color) throw new Error('Map theme colors are unavailable.');
   const concrete = view.getComputedStyle(probe).color;
   const match = /^(rgb|rgba)\(([^)]+)\)$/.exec(concrete);
   const parts = match?.[2].split(',').map(part => part.trim());
   const channels = parts?.map(Number);
   if (!match || !parts || parts.some(part => !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(part)) || !channels || channels.length !== (match[1] === 'rgba' ? 4 : 3)
     || channels.some((channel, index) => !Number.isFinite(channel) || channel < 0 || channel > (index === 3 ? 1 : 255))) {
    throw new Error('Map theme colors are unavailable.');
   }
   return [key, concrete];
  }));
 } finally {
  probe.remove();
 }
}
