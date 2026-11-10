import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
interface Catalog {
 package: string;
 version: string;
 ic: Record<string, string>;
 extra: string[];
 aliases: Record<string, string>;
 filled: string[];
}
type SvgAttributes = Record<string, string | number>;
type LucideElement = readonly [tag: string, props: SvgAttributes];
const catalog: Catalog = JSON.parse(fs.readFileSync(path.join(root,'apps/app/src/icon-catalog.json'),'utf8'));
const source=process.argv[2];
if(!source)throw Error('Supply the installed published lucide-react package directory.');
const published: {name: string; version: string} = JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8'));
if(published.name!==catalog.package||published.version!==catalog.version)throw Error('Lucide source does not match the pinned catalog.');
const output=path.join(root,'apps/app/public/icons/lucide');fs.mkdirSync(output,{recursive:true});
const {default: defaults}: {default: SvgAttributes} = await import(pathToFileURL(path.join(source,'dist/esm/defaultAttributes.mjs')).href);
const hash=(bytes: string | Buffer)=>createHash('sha256').update(bytes).digest('hex');
const escape=(value: string | number)=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const svgNames: Record<string, string> = {strokeWidth:'stroke-width',strokeLinecap:'stroke-linecap',strokeLinejoin:'stroke-linejoin'};
const attributes=(value: SvgAttributes)=>Object.entries(value).filter(([key])=>key!=='key').map(([key,value])=>`${svgNames[key] ?? key}="${escape(value)}"`).join(' ');
const sourceFiles: Record<string, string> = {};
const assets: Record<string, {source: string; sha256: string; fill?: 'currentColor'}> = {};
for(const name of new Set([...Object.values(catalog.ic),...catalog.extra])){
 const file=(catalog.aliases[name]||name)+'.mjs',sourcePath=path.join(source,'dist/esm/icons',file);
 const {__iconNode}: {__iconNode: LucideElement[]} = await import(pathToFileURL(sourcePath).href);sourceFiles[file]=hash(fs.readFileSync(sourcePath));
 for(const filled of [false,...(catalog.filled.includes(name)?[true]:[])]){
  const asset=name+(filled?'-filled':'')+'.svg';
  const svg=`<!-- Lucide ${file}; ${catalog.package} ${catalog.version}. See LICENSE.txt and source.json. -->\n<svg ${attributes({...defaults,...(filled?{fill:'currentColor'}:{})})}>${__iconNode.map(([tag,props])=>`<${tag} ${attributes(props)}/>`).join('')}</svg>\n`;
  fs.writeFileSync(path.join(output,asset),svg);assets[asset]={source:file,sha256:hash(svg),...(filled?{fill:'currentColor'}:{})};
 }
}
const license=fs.readFileSync(path.join(source,'LICENSE'));fs.writeFileSync(path.join(output,'LICENSE.txt'),license);
fs.writeFileSync(path.join(output,'source.json'),JSON.stringify({package:catalog.package,version:catalog.version,repository:'https://github.com/lucide-icons/lucide',sourceFiles,assets,license:'ISC and upstream Feather MIT where listed',licenseSha256:hash(license),conversion:'Exact published __iconNode geometry and default SVG attributes. React-only keys removed; SVG attribute spelling normalized. Documented fill variants preserve existing selected/playback state without changing geometry.'},null,2)+'\n');
console.log(`Verified ${Object.keys(catalog.ic).length} canonical keys, wrote ${Object.keys(assets).length} Lucide assets.`);
