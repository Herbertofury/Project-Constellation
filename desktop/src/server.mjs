import http from 'node:http';
import crypto from 'node:crypto';
import { loadConfig, APP_NAME, VERSION } from './config.mjs';
import { createRuntimeState } from './state.mjs';
import { createToolHandler } from './tools.mjs';
import { toolDefinitions } from './tool-definitions.mjs';
import { stopManagedProcess } from './process-manager.mjs';
import { closeComputerUseHelper } from './computer-use.mjs';

const SUPPORTED = ['2026-07-28','2025-06-18','2025-03-26','2024-11-05'];
const jsonHeaders = { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' };

function send(res,status,body,extra={}) { res.writeHead(status,{...jsonHeaders,...extra}); res.end(body==null?'':JSON.stringify(body)); }
function rpcResult(id,result){return {jsonrpc:'2.0',id,result};}
function rpcError(id,code,message,data){return {jsonrpc:'2.0',id:id??null,error:{code,message,...(data===undefined?{}:{data})}};}
async function readBody(req){ const chunks=[]; for await (const c of req) chunks.push(c); const raw=Buffer.concat(chunks).toString('utf8'); if(!raw)return null; return JSON.parse(raw); }

export async function createCommanderServer(overrides={}) {
  const loaded=await loadConfig(); const config=Object.assign(loaded.config,overrides.config||{}); const state=createRuntimeState(loaded.dir); const sessions=new Set(); let server;
  let closing;
  const shutdown=async()=>{
    if(closing)return closing;
    state.shuttingDown=true;
    for(const job of state.searches.values())job.cancelled=true;
    closing=(async()=>{
      let timer;
      const serverClosed=new Promise((resolve,reject)=>{
        if(!server?.listening)return resolve();
        server.close(error=>error?reject(error):resolve());
      });
      const cleanup=(async()=>{
        const operations=[
          closeComputerUseHelper().then(result=>{if(result?.stopped===false)throw new Error(result.reason);}),
          ...[...state.processes.values()].filter(session=>session.child).map(session=>stopManagedProcess(session)),
          ...[...state.tasks.jobs.values()].map(task=>task._run).filter(Boolean),
          ...[...state.searches.values()].map(job=>job.promise).filter(Boolean),
          serverClosed,
        ];
        const results=await Promise.allSettled(operations);
        const failures=results.filter(result=>result.status==='rejected').map(result=>result.reason);
        if(failures.length)throw new AggregateError(failures,'Owned CLI work did not confirm cleanup.');
        await state.recordQueue;
        return {stopped:true};
      })();
      try{return await Promise.race([cleanup,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('CLI shutdown cleanup is unconfirmed after ten seconds.')),10000);})]);}
      finally{clearTimeout(timer);}
    })();
    try{return await closing;}finally{closing=null;}
  };
  const callTool=createToolHandler({config,configPath:loaded.configPath,state,onShutdown:shutdown});
  const mcpPath=`/${config.endpointToken}/mcp`;

  const handler=async(req,res)=>{
    try {
      const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
      if(url.pathname===`/${config.endpointToken}/healthz` && req.method==='GET') return send(res,200,{ok:true,app:APP_NAME,version:VERSION,deviceName:config.deviceName});
      if(url.pathname!==mcpPath) return send(res,404,{error:'not found'});
      if(config.requireBearer === true) {
        const auth=req.headers.authorization||''; if(auth!==`Bearer ${config.bearerToken}`) return send(res,401,{error:'unauthorized'},{'www-authenticate':'Bearer'});
      }
      if(req.method==='DELETE'){ const sid=req.headers['mcp-session-id']; if(sid)sessions.delete(String(sid)); return send(res,204,null); }
      if(req.method!=='POST') return send(res,405,rpcError(null,-32601,'Method not found'));
      let msg; try{msg=await readBody(req);}catch(e){return send(res,400,rpcError(null,-32700,'Parse error',String(e.message||e)));}
      if(!msg||msg.jsonrpc!=='2.0'||!msg.method) return send(res,400,rpcError(msg?.id,-32600,'Invalid Request'));
      const id=msg.id;
      const method=msg.method;
      const protocol=String(req.headers['mcp-protocol-version']||msg?.params?._meta?.['io.modelcontextprotocol/protocolVersion']||msg?.params?.protocolVersion||'2025-06-18');

      if(method==='notifications/initialized'){ res.writeHead(202,{'cache-control':'no-store'}); return res.end(); }
      if(method==='server/discover') return send(res,200,rpcResult(id,{resultType:'complete',protocolVersions:SUPPORTED,serverInfo:{name:'constellation-commander',title:APP_NAME,version:VERSION},capabilities:{tools:{listChanged:false}}}));
      if(method==='initialize'){
        const negotiated=SUPPORTED.includes(msg.params?.protocolVersion)?msg.params.protocolVersion:'2025-06-18'; const sid=crypto.randomUUID(); sessions.add(sid);
        return send(res,200,rpcResult(id,{protocolVersion:negotiated,capabilities:{tools:{listChanged:false}},serverInfo:{name:'constellation-commander',title:APP_NAME,version:VERSION},instructions:'Local-computer MCP commander. No vendor tool-call quota. Use file/process tools only for the user requested task.'}),{'Mcp-Session-Id':sid,'MCP-Protocol-Version':negotiated});
      }
      if(method==='ping') return send(res,200,rpcResult(id,{}));
      if(method==='tools/list') return send(res,200,rpcResult(id,{resultType:'complete',tools:toolDefinitions(),ttlMs:300000,cacheScope:'server'}));
      if(method==='tools/call'){
        const name=msg.params?.name; if(typeof name!=='string') return send(res,400,rpcError(id,-32602,'Invalid params: missing tool name'));
        try {
          const data=await callTool(name,msg.params?.arguments||{});
          const attachments=Array.isArray(data?._attachments)?data._attachments:[];
          const structured=(data&&typeof data==='object')?{...data}:data;
          if(structured&&typeof structured==='object') delete structured._attachments;
          const content=[{type:'text',text:JSON.stringify(structured,null,2)}];
          for(const attachment of attachments){
            if(attachment?.base64&&attachment?.mimeType?.startsWith('image/')) content.push({type:'image',data:attachment.base64,mimeType:attachment.mimeType});
          }
          return send(res,200,rpcResult(id,{resultType:'complete',content,structuredContent:structured,isError:false}));
        }
        catch(e){ return send(res,200,rpcResult(id,{resultType:'complete',content:[{type:'text',text:String(e.message||e)}],isError:true})); }
      }
      return send(res,404,rpcError(id,-32601,'Method not found'));
    } catch(e){ return send(res,500,rpcError(null,-32603,'Internal error',String(e.message||e))); }
  };

  server=http.createServer(handler);
  return { server, config, state, mcpPath, healthPath:`/${config.endpointToken}/healthz`, listen:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,config.host,()=>resolve(server.address()));}), close:shutdown };
}
