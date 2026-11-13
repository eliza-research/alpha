import createDOMPurify from 'dompurify';

const purifier=createDOMPurify();
const imageUrl=(value:string)=>{
  if(/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(value))return value;
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
};
purifier.addHook('uponSanitizeAttribute',(node,data)=>{
  if(node.nodeName==='IMG'&&data.attrName==='src'){
    const url=imageUrl(data.attrValue);if(url)node.setAttribute('data-alpha-image',url);
  }
  if(node.nodeName==='A'&&data.attrName==='href'){
    try{const url=new URL(data.attrValue);if(url.protocol==='https:'&&!url.username&&!url.password)node.setAttribute('data-alpha-link',url.href);}catch{}
  }
});
/** Email markup is isolated from app CSS and scripts. The caller applies the saved
 * image preference. No requests, scripts, forms or navigation during preparation. */
export function prepareMailHtml(html:string,showRemoteImages=false):{document:string;remoteImages:number;inlineLinks:ReadonlySet<string>}{
  if(new TextEncoder().encode(html).length>512*1024)throw Error('Formatted email is too large');
  const content=purifier.sanitize(html,{USE_PROFILES:{html:true},RETURN_DOM_FRAGMENT:true,ALLOW_DATA_ATTR:false,ADD_ATTR:['data-alpha-image','data-alpha-link'],ADD_TAGS:['style'],FORBID_TAGS:['form','input','button','textarea','select','iframe','object','embed','video','audio','source','link','meta','base'],FORBID_ATTR:['src','srcset','href','action','formaction','background','ping','target','autofocus']});
  let remoteImages=0;
  for(const node of content.querySelectorAll<HTMLImageElement>('img')){
    const src=imageUrl(node.getAttribute('data-alpha-image')||'');node.removeAttribute('data-alpha-image');
    if(src?.startsWith('https:')){remoteImages++;if(showRemoteImages)node.src=src;else{const label=document.createElement('span');label.textContent=node.alt?`[Image: ${node.alt}]`:'[Image]';label.style.color='#666';node.replaceWith(label);}}
    else if(src)node.src=src;else node.remove();
  }
  const inlineLinks=new Set<string>();
  for(const node of content.querySelectorAll('a[data-alpha-link]')){node.setAttribute('role','link');node.setAttribute('tabindex','0');inlineLinks.add(node.getAttribute('data-alpha-link')!);}
  const container=document.createElement('div');container.append(content);
  const csp=`default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:${showRemoteImages?' https:':''}; font-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`;
  return {document:`<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{overflow:hidden}html,body{margin:0;padding:0;color:#171717;background:#fff;font:15px/1.5 Arial,sans-serif;overflow-wrap:anywhere}img{max-width:100vw;height:auto}td{overflow-wrap:anywhere}a[role=link]{color:#245dc1;cursor:pointer;text-decoration:underline}:focus-visible{outline:2px solid #245dc1}</style></head><body>${container.innerHTML}</body></html>`,remoteImages,inlineLinks};
}

/** Fit a sender's table layout without collapsing image columns or adding sideways scrolling. */
export function fitMailFrame(frame:HTMLIFrameElement):()=>void {
  const doc=frame.contentDocument;
  if(!doc)return ()=>{};
  let lastWidth=0;
  const fit=()=>{
    const available=frame.clientWidth;
    if(!frame.isConnected||!available)return;
    lastWidth=available;
    doc.body.style.zoom='1';
    doc.body.style.width='auto';
    const width=Math.max(available,doc.body.scrollWidth,doc.documentElement.scrollWidth);
    doc.body.style.width=`${width}px`;
    const scale=available/width;
    doc.body.style.zoom=String(scale);
    frame.style.height=`${Math.ceil(Math.max(doc.body.scrollHeight,doc.body.offsetHeight)*scale)}px`;
  };
  const observer=new ResizeObserver(()=>{if(frame.clientWidth!==lastWidth)fit();});
  observer.observe(frame);
  doc.addEventListener('load',fit,true);
  fit();
  return ()=>{observer.disconnect();doc.removeEventListener('load',fit,true);};
}
