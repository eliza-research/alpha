import 'maplibre-gl/dist/maplibre-gl.css';
import { MapPlane as SharedMapPlane, type MapBasemap } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/map-plane.ts';
import fontUrl from '@fontsource/public-sans/files/public-sans-latin-400-normal.woff2?url';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { nativeRegion, nativeRegionRequest } from './regional-provider';
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

/** Product palette, typography and space reserved for the Alpha route sheets. The shared
 * plane reflows the selected place when these sheets move (plugin-maps 5176c4523c). */
export class MapPlane extends SharedMapPlane {
 constructor(container:HTMLElement,region:MapBasemap,onError:()=>void,colors:Record<string,string>,onPin?:(id:string)=>void) {
  super(container,region,onError,region.kind==='global'?colors:resolveMapColors(container,colors),{fontUrl,workerUrl,accent:'#1616d8',protocol:'alpha-region',routePadding:{top:220,bottom:280,left:30,right:30},nativeRegion,nativeRequest:nativeRegionRequest,selectionPadding:region.kind==='global'?()=>{
   const bounds=container.getBoundingClientRect();
   const credits=container.parentElement?.querySelector('.alpha-map-credits')?.getBoundingClientRect();
   const header=container.parentElement?.querySelector('[data-alpha-app-header="main"]')?.getBoundingClientRect();
   const sheet=container.parentElement?.querySelector('[data-alpha-maps-sheet]')?.getBoundingClientRect();
   const right=sheet&&sheet.left>bounds.left+30?Math.max(30,bounds.right-sheet.left+30):30;
   return {top:header?header.bottom-bounds.top+60:100,bottom:credits?bounds.bottom-credits.top+16:Math.min(430,container.clientHeight*.52+30),left:30,right};
  }:undefined,onPin});
 }
}
