#!/usr/bin/env node
/** Render Alpha's existing vector identity; no upstream source or phone mutation. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const root=path.resolve(import.meta.dirname,'..');
const output=path.resolve(process.argv[2]||path.join(root,'android/aosp/branding/generated'));
const packageFile=process.env.ALPHA_BRANDING_RENDER_PACKAGE||path.join(root,'package.json');
const require=createRequire(packageFile);
const sharp=require('sharp');
if(fs.existsSync(output))throw Error('Use a new output directory; preserve previous rendered assets.');
const logo=path.join(root,'apps/app/public/logo-mark.svg');
const svg=fs.readFileSync(logo,'utf8');
const geometry=svg.replace(/^[\s\S]*?<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'').replaceAll('fill="#000000"','fill="#FFFFFF"');
const width=1080,height=2424;
const mark=(x,y,size,opacity=1)=>`<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 120 120" overflow="hidden" opacity="${opacity}">${geometry}</svg>`;
const frame=(background,content)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="1080" height="2424" fill="${background}"/>${content}</svg>`);
fs.mkdirSync(path.join(output,'part0'),{recursive:true});
fs.mkdirSync(path.join(output,'part1'));
// A single calm reveal; the final frame holds until Android finishes booting.
for(let i=0;i<18;i++){
 const t=1-Math.pow(1-i/17,3),size=216+24*t;
 await sharp(frame('#0000FF',mark((width-size)/2,(height-size)/2,size,0.2+0.8*t))).png().toFile(path.join(output,'part0',`${String(i).padStart(4,'0')}.png`));
}
fs.copyFileSync(path.join(output,'part0','0017.png'),path.join(output,'part1','0000.png'));
fs.writeFileSync(path.join(output,'desc.txt'),`${width} ${height} 30\np 1 0 part0\np 0 0 part1\n`);
// Clear upper area for Android's lock-screen clock and notifications.
await sharp(frame('#050505',`<circle cx="540" cy="1410" r="250" fill="#0000FF"/>${mark(378,1248,324)}`)).png().toFile(path.join(output,'default_wallpaper.png'));
const osRoot=process.env.ALPHA_OS_SOURCE_ROOT;
if(!osRoot)throw Error('Set ALPHA_OS_SOURCE_ROOT to the pinned elizaOS/os checkout.');
const toolLock=JSON.parse(fs.readFileSync(path.join(root,'android/aosp/branding/tools.lock.json'),'utf8'));
for(const [relative,expected] of Object.entries(toolLock.files)){
 const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(osRoot,relative))).digest('hex');
 if(actual!==expected)throw Error('Branding tool differs from reviewed OS input: '+relative);
}
const {buildBootAnimationZip}=await import(pathToFileURL(path.join(osRoot,'scripts/distro-android/build-bootanimation.mjs')).href);
buildBootAnimationZip({framesDir:output,outPath:path.join(output,'bootanimation.zip')});
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const report={schema:1,sourceLogo:'apps/app/public/logo-mark.svg',sourceLogoSha256:hash(logo),width,height,fps:30,accent:'#0000FF',wallpaperBackground:'#050505',bootAnimationSha256:hash(path.join(output,'bootanimation.zip')),wallpaperSha256:hash(path.join(output,'default_wallpaper.png')),firmwareSplashModified:false,imageBuilt:false,deviceVerified:false};
fs.writeFileSync(path.join(output,'branding-assets.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
