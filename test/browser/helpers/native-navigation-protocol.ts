/** Test-boundary protocol shared by the native renderer fixtures, never product code.
 * `ownerId` is the signed-in owner, or a getter for fixtures whose owner changes between connections. */
export function installNativeNavigationFixture() {
  (window as any).createNativeNavigationFixture=(ownerId: string|(()=>string),agentId: string,f: {unexpected: string[]})=>{
    const owner=()=>typeof ownerId==='function'?ownerId():ownerId;
    const ok=(data: unknown)=>({status:200,data});
    let installationId='',deviceKey='';
    const navigationPrepared = new Map<string, {binding: any; claimId?: string}>();
    const navigationViews = new Set(['chat','inbox','calendar','browser','camera','photos','maps','notes','files','automations','settings']);
    const navigationRequest = (method: string, path: string, body: any, requestOwner: unknown) => {
      const reject = () => { f.unexpected.push(method + ' ' + path); return {status:409,data:{error:'Invalid fixture navigation contract'}}; };
      if (requestOwner !== owner() || method !== 'POST' || !body || typeof body !== 'object' || Array.isArray(body)) return reject();
      const exact = (keys: string[]) => Object.keys(body).length === keys.length && Object.keys(body).every(key => keys.includes(key));
      const safe = (value: unknown, pattern: RegExp) => typeof value === 'string' && pattern.exec(value)?.[0] === value;
      const prepare = /^\/api\/views\/([A-Za-z0-9_-]+)\/navigate$/.exec(path);
      if (prepare?.[0] === path) {
        const viewId=prepare[1];
        if (!navigationViews.has(viewId) || !exact(['clientId','delivery','prepareOnly','viewType','completedActionHandoffId']) || body.delivery !== 'completed-action' || body.prepareOnly !== true || body.viewType !== 'gui' || !safe(body.clientId,/^[A-Za-z0-9._-]{1,128}$/) || !safe(body.completedActionHandoffId,/^[A-Za-z0-9._:-]{1,128}$/) || navigationPrepared.has(body.completedActionHandoffId)) return reject();
        const binding={requestId:body.completedActionHandoffId,clientId:body.clientId,viewId,viewType:'gui',installationId:'fixture-view-'+viewId};
        navigationPrepared.set(binding.requestId,{binding});
        return ok({ok:true,status:'prepared',viewId,navigationBinding:binding,completedActionHandoffId:binding.requestId});
      }
      const saved=navigationPrepared.get(body.requestId);
      if (!saved || Object.entries(saved.binding).some(([key,value])=>body[key]!==value)) return reject();
      if (path === '/api/views/interact-claim') {
        if (!exact(['requestId','clientId','viewId','viewType','installationId']) || saved.claimId) return reject();
        saved.claimId=crypto.randomUUID();return ok({claimId:saved.claimId});
      }
      if (path === '/api/views/interact-result') {
        if (!exact(['requestId','clientId','viewId','viewType','installationId','claimId','success','result']) || !saved.claimId || body.claimId!==saved.claimId || typeof body.success!=='boolean' || !body.result || Object.keys(body.result).length!==1 || body.result.switched!==body.success) return reject();
        navigationPrepared.delete(body.requestId);return ok({ok:true,accepted:true});
      }
      return reject();
    };
    return {
      register(headers: Record<string,string>){installationId=headers['X-Eliza-Device-Id'];deviceKey=headers['X-Eliza-Device-Key'];},
      request(method: string,path: string,body: any,headers: Record<string,string>,requestOwner: unknown){
        // The current renderer probes optional observation support and warms an idle
        // Cloud connection. These synthetic responses advertise no capabilities and
        // perform no inference; retain the owner/method/body boundary of both routes.
        if(path==='/api/status'||path==='/api/cloud/warm'){
          const expectedMethod=path==='/api/status'?'GET':'POST';
          const emptyObject=body!==null&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===0;
          if(requestOwner===owner()&&method===expectedMethod&&(emptyObject||(expectedMethod==='GET'&&body===undefined)))return ok({});
          f.unexpected.push(method+' '+path);return {status:400,data:{error:'Invalid fixture lifecycle contract'}};
        }
        if(path.startsWith('/api/views/')&&(path.endsWith('/navigate')||path==='/api/views/interact-claim'||path==='/api/views/interact-result'))return navigationRequest(method,path,body,requestOwner);
        if(path==='/api/client-devices/context'){
          const id=owner();
          if(method==='GET'&&requestOwner===id&&installationId&&headers['X-Eliza-Device-Id']===installationId&&headers['X-Eliza-Device-Key']===deviceKey)return ok({subjectUserId:id,agentId,installationId,enrollmentId:'fixture-enrollment'});
          f.unexpected.push(method+' '+path);return {status:404,data:{}};
        }
      },
    };
  };
}
