import readline from 'node:readline';import fs from 'node:fs/promises';import path from 'node:path';
import {createToolHandler} from '../src/tools.mjs';
import {createRuntimeState} from '../src/state.mjs';
import {toolDefinitions} from '../src/tool-definitions.mjs';
import {getComputerLinkStatus,getComputerLinkMcpStatus} from '../src/computer-link.mjs';
import {stopManagedProcess} from '../src/process-manager.mjs';
const dir=process.env.COMMANDER_UI_TEST_HOME,root=path.join(dir,'workspace');await fs.mkdir(root,{recursive:true});await fs.mkdir(path.join(dir,'searches'),{recursive:true});
await fs.writeFile(path.join(root,'example.txt'),'original text\n');
const state=createRuntimeState(dir),config={allowedRoots:[root],enableShell:true,enableGuiAutomation:false,blockedCommands:[],searchIgnore:[],localToolMode:'auto'};
const call=createToolHandler({config,configPath:path.join(dir,'config.json'),state});let chatCalls=0;const pending=new Map(),diagnostics=[];
for await(const line of readline.createInterface({input:process.stdin})){
 const request=JSON.parse(line);try{let result;const {op,args={}}=request;
 if(op==='snapshot')result={ok:true,version:'0.24.0',config,chat:{phase:'error',lastError:'Offline fixture',pageHookReady:false},recentCalls:[],stats:{totalCalls:0},toolCount:toolDefinitions().length,pendingResults:[...pending.values()]};
 else if(op==='listTools')result={ok:true,tools:toolDefinitions()};
 else if(op==='native-status')result=await getComputerLinkStatus();
 else if(op==='native-session')result=await getComputerLinkMcpStatus();
 else if(op==='runTool')result={ok:true,result:await call(args.name,args.args||{})};
 else if(op==='cc:bootstrap')result={ok:true,nonce:'ui-test-nonce',expiresAt:new Date(Date.now()+60000).toISOString(),tools:toolDefinitions(),contract:'fixture'};
 else if(op==='cc:call'){chatCalls++;result={ok:true,id:args.call.id,tool:args.call.tool,result:await call(args.call.tool,args.call.args||{})};}
 else if(op==='cc:save-result'){pending.set(args.id,args);result={ok:true};}
 else if(op==='cc:ack-result'){pending.delete(args.id);result={ok:true};}
 else if(op==='cc:diagnostic'){diagnostics.push(args);result={ok:true};}
 else if(op==='metrics')result={chatCalls,pending:[...pending.values()],diagnostics};
 else if(op==='cc:status')result={ok:true,localToolMode:'auto',version:'0.24.0'};
 else result={ok:true};
 console.log(JSON.stringify({id:request.id,result}));
 }catch(e){console.log(JSON.stringify({id:request.id,error:String(e.message)}));}
}
await Promise.all([...state.processes.values()].filter(session=>session.child).map(session=>stopManagedProcess(session).catch(error=>console.error(error.message))));
