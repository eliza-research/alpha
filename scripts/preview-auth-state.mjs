// Serves only the real auth component plus a local, synthetic review fixture.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root=fileURLToPath(new URL('../',import.meta.url));
const port=Number(process.env.ALPHA_AUTH_REVIEW_PORT||18744);
const result=await build({absWorkingDir:root,entryPoints:['test/fixtures/auth-state-preview.tsx'],bundle:true,write:false,outdir:resolve(root,'test-results/auth-review'),platform:'browser',format:'esm',jsx:'automatic',external:['/logo-mark.svg','/icons/senders/google.com.png']});
const files=new Map(result.outputFiles.map(file=>['/'+basename(file.path),file.contents]));
const assets={'/logo-mark.svg':'image/svg+xml','/icons/senders/google.com.png':'image/png'};
const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Alpha · local auth UI review</title><link rel="stylesheet" href="/auth-state-preview.css"><style>
*{box-sizing:border-box}body{margin:0;font-family:'Public Sans',system-ui,sans-serif;--bg:#fff;--fg:#050505;--connection-bg:#fff;--connection-fg:#050505;--connection-acc:#0000ff;--connection-mut:#595959;--connection-line:#dedede}button{font:inherit;cursor:pointer;border:0}.review-toolbar{position:relative;z-index:10001;background:#f0f0f4;padding:12px 16px;display:flex;flex-wrap:wrap;gap:10px;font-size:13px}.review-toolbar span{flex-basis:100%}.review-toolbar button{min-height:36px;padding:6px 10px;border:1px solid #ccc;border-radius:6px}.alpha-auth-page{position:relative;min-height:calc(100dvh - 130px)}.alpha-auth-page .alpha-auth-content{padding-block:30px;justify-content:flex-start}.serif{font-family:Georgia,serif}
</style></head><body><div id="root"></div><script type="module" src="/auth-state-preview.js"></script></body></html>`;
createServer((request,response)=>{
  const path=new URL(request.url,'http://localhost').pathname;
  response.setHeader('Cache-Control','no-store');
  if(path==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html);}
  else if(files.has(path)){response.setHeader('Content-Type',path.endsWith('.css')?'text/css':'text/javascript');response.end(files.get(path));}
  else if(assets[path]){response.setHeader('Content-Type',assets[path]);response.end(readFileSync(resolve(root,'apps/app/public'+path)));}
  else{response.statusCode=404;response.end();}
}).listen(port,'127.0.0.1',()=>console.log(`Local simulated auth review: http://127.0.0.1:${port}/`));
