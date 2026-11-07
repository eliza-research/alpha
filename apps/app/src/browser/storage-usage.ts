import {registerPlugin} from '../platform-plugins';
const files=registerPlugin<{usage():Promise<{bytes:number;files:number}>}>('AlphaFiles');
export const formatBytes=(value:number)=>{const units=['B','KiB','MiB','GiB','TiB'];let index=0;while(value>=1024&&index<units.length-1){value/=1024;index++;}return `${Number(value.toFixed(index?1:0))} ${units[index]}`;};
export async function browserStorageUsage(){
 try{const estimate=await navigator.storage?.estimate?.();if(estimate&&Number.isFinite(estimate.usage)&&estimate.usage!>=0&&Number.isFinite(estimate.quota)&&estimate.quota!>0)return {storageText:`${formatBytes(estimate.usage!)} of ${formatBytes(estimate.quota!)} app storage used`,storageW:`${Math.min(100,estimate.usage!/estimate.quota!*100)}%`,storageBarStyle:''};}catch{}
 const local=await files.usage();return {storageText:`${formatBytes(local.bytes)} in ${local.files} app file${local.files===1?'':'s'}`,storageW:'0%',storageBarStyle:'display:none'};
}
