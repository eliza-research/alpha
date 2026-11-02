import 'maplibre-gl/dist/maplibre-gl.css';
import { MapPlane as SharedMapPlane, type MapBasemap } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/map-plane.ts';
import fontUrl from '@fontsource/public-sans/files/public-sans-latin-400-normal.woff2?url';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { nativeRegion, nativeRegionRequest } from './regional-provider';
import { alphaPaletteColor } from '../product/alpha-product';

/** The prototype names its map colours as palette references (var(--alpha-map-...), #742),
 * but MapLibre's style specification takes colour values, not CSS. Resolve each reference
 * against the theme applied to the plane's container, falling back to the product record. */
export function resolveMapColors(container:HTMLElement,colors:Record<string,string>):Record<string,string> {
 const style=getComputedStyle(container);
 return Object.fromEntries(Object.entries(colors).map(([key,value])=>{
  const reference=/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+?)\s*)?\)$/.exec(value.trim());
  if(!reference)return [key,value];
  return [key,style.getPropertyValue(reference[1]).trim()||alphaPaletteColor(reference[1])||reference[2]||value];
 }));
}
/** Product palette, typography and space reserved for the Alpha route sheets. The shared
 * plane reflows the selected place when these sheets move (plugin-maps 5176c4523c). */
export class MapPlane extends SharedMapPlane {
 constructor(container:HTMLElement,region:MapBasemap,onError:()=>void,colors:Record<string,string>,onPin?:(id:string)=>void) {
  super(container,region,onError,resolveMapColors(container,colors),{fontUrl,workerUrl,accent:'#1616d8',protocol:'alpha-region',routePadding:{top:220,bottom:280,left:30,right:30},nativeRegion,nativeRequest:nativeRegionRequest,selectionPadding:region.kind==='global'?()=>{
   const bounds=container.getBoundingClientRect();
   const credits=container.parentElement?.querySelector('.alpha-map-credits')?.getBoundingClientRect();
   const header=container.parentElement?.querySelector('[data-alpha-app-header="main"]')?.getBoundingClientRect();
   const sheet=container.parentElement?.querySelector('[data-alpha-maps-sheet]')?.getBoundingClientRect();
   const right=sheet&&sheet.left>bounds.left+30?Math.max(30,bounds.right-sheet.left+30):30;
   return {top:header?header.bottom-bounds.top+60:100,bottom:credits?bounds.bottom-credits.top+16:Math.min(430,container.clientHeight*.52+30),left:30,right};
  }:undefined,onPin});
 }
}
