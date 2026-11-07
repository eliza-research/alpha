// Synthetic provider boundary: no request can leave this child process.
import http from 'node:http';
const listen=http.Server.prototype.listen;
http.Server.prototype.listen=function(port,host,callback){return listen.call(this,0,'127.0.0.1',()=>{process.send({port:this.address().port});callback?.();});};
globalThis.fetch=async(url,options={})=>{
 if(url==='https://provider.invalid/models')return Response.json({data:[{id:process.env.ALPHA_DEV_MODEL}]});
 if(url!=='https://provider.invalid/chat/completions')throw new Error('Unexpected synthetic provider request');
 const body=JSON.parse(options.body);const schema=body.tools.map(t=>t.function.name);
 process.send({schema});
 const request=body.messages.at(-1).content;
 const call=request==='list'?{name:'VIEWS',arguments:JSON.stringify({action:'list'})}:request==='long-note'?{name:'DEVICE_NOTE_CREATE',arguments:JSON.stringify({operation:{type:'create_note',title:'N'.repeat(256),body:'B'.repeat(32000)},operationKey:'long-note',reason:'Explicit preview'})}:{name:'VIEWS',arguments:JSON.stringify({action:'show',view:request})};
 return Response.json({choices:[{message:{content:request==='list'?null:'Review this synthetic proposal.',tool_calls:[{function:call}]}}]});
};
