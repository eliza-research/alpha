import 'maplibre-gl/dist/maplibre-gl.css';
import { MapPlane as SharedMapPlane, type MapBasemap } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/map-plane.ts';
import fontUrl from '@fontsource/public-sans/files/public-sans-latin-400-normal.woff2?url';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { nativeRegion, nativeRegionRequest } from './regional-provider';
import { resolveMapColors } from './theme-colors';
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
