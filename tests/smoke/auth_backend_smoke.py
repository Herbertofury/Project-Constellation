from playwright.sync_api import sync_playwright
import pathlib, json, re, os
root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation'))
manifest=json.loads((root/'manifest.json').read_text())
manifest.setdefault('oauth2', {'scopes':['https://www.googleapis.com/auth/drive.file']})
manifest['oauth2']['client_id']='pc-test.apps.googleusercontent.com'
brain=(root/'src/brain-core.js').read_text(); providers=(root/'src/provider-core.js').read_text(); integrity=(root/'src/integrity-core.js').read_text(); knowledge=(root/'src/knowledge-core.js').read_text(); health=(root/'src/health-core.js').read_text(); bg=(root/'background.js').read_text()
bg=re.sub(r"^import ['\"]\./src/(?:brain-core|provider-core|integrity-core|knowledge-core|health-core)\.js['\"];\s*",'',bg,flags=re.M)
mock=f"""
(()=>{{
 const local={{}}, session={{}}, listeners={{}}, calls=[], opened=[];
 const area=(bag)=>({{get:async(keys)=>{{if(keys==null)return {{...bag}};if(typeof keys==='string')return {{[keys]:bag[keys]}};if(Array.isArray(keys))return Object.fromEntries(keys.map(k=>[k,bag[k]]));return Object.fromEntries(Object.keys(keys||{{}}).map(k=>[k,bag[k]??keys[k]]));}},set:async(obj)=>Object.assign(bag,obj),remove:async(keys)=>{{for(const k of (Array.isArray(keys)?keys:[keys]))delete bag[k];}}}});
 globalThis.chrome={{
  runtime:{{id:'geljambmkfjkhodgkpjhnmfojkpcamig',getManifest:()=>({json.dumps(manifest)}),onMessage:{{addListener:(fn)=>listeners.message=fn}},onInstalled:{{addListener:(fn)=>listeners.installed=fn}},onStartup:{{addListener:(fn)=>listeners.startup=fn}}}},
  storage:{{local:area(local),session:area(session)}},
  alarms:{{create:async()=>{{}},clear:async()=>true,onAlarm:{{addListener:(fn)=>listeners.alarm=fn}}}},
  sidePanel:{{setPanelBehavior:async()=>{{}}}},action:{{setBadgeText:async()=>{{}},setTitle:async()=>{{}}}},idle:{{queryState:async()=> 'idle'}},
  identity:{{getAuthToken:async()=>({{token:'google-token',grantedScopes:['https://www.googleapis.com/auth/drive.file']}}),removeCachedAuthToken:async()=>{{}},clearAllCachedAuthTokens:async()=>{{}}}},
  tabs:{{query:async(q)=>String(q?.url||'').includes('chatgpt.com')?[{{id:42,url:'https://chatgpt.com/c/test'}}]:[],create:async(o)=>{{opened.push(o.url);return {{id:9,url:o.url}};}},sendMessage:async(id,m)=>m.type==='PC_AUTH_STATUS'?{{ok:true,state:'connected',composer:true,currentChat:true,checkedAt:Date.now()}}:{{ok:true}}}},permissions:{{contains:async()=>true,request:async()=>true}},history:{{search:async()=>[]}},offscreen:{{createDocument:async()=>{{}}}},downloads:{{}}
 }};
 let repoAttempts=0;
 globalThis.fetch=async(url,opt={{}})=>{{
   url=String(url);const body=String(opt.body||'');calls.push({{url,method:opt.method||'GET',body}});
   if(url.includes('github.com/login/device/code')) return new Response(JSON.stringify({{device_code:'dev123',user_code:'ABCD-EFGH',verification_uri:'https://github.com/login/device',expires_in:900,interval:5}}),{{status:200,headers:{{'Content-Type':'application/json'}}}});
   if(url.includes('github.com/login/oauth/access_token')&&body.includes('grant_type=refresh_token')) return new Response(JSON.stringify({{access_token:'gh-token-refreshed',refresh_token:'gh-refresh-2',expires_in:28800,refresh_token_expires_in:15897600,token_type:'bearer',scope:'repo,read:user'}}),{{status:200,headers:{{'Content-Type':'application/json'}}}});
   if(url.includes('github.com/login/oauth/access_token')) return new Response(JSON.stringify({{access_token:'gh-token',refresh_token:'gh-refresh-1',expires_in:28800,refresh_token_expires_in:15897600,token_type:'bearer',scope:'repo,read:user'}}),{{status:200,headers:{{'Content-Type':'application/json'}}}});
   if(url.includes('api.github.com/user/repos')&&repoAttempts++===0) return new Response(JSON.stringify({{message:'Bad credentials'}}),{{status:401,headers:{{'Content-Type':'application/json'}}}});
   if(url.includes('api.github.com/user/repos')) return new Response(JSON.stringify([{{id:1,full_name:'bert/project-constellation',name:'project-constellation',owner:{{login:'bert'}},private:false,default_branch:'main',html_url:'https://github.com/bert/project-constellation',permissions:{{push:true}}}}]),{{status:200,headers:{{'Content-Type':'application/json'}}}});
   if(url.endsWith('api.github.com/user')) return new Response(JSON.stringify({{login:'bert',avatar_url:'https://example.com/a.png'}}),{{status:200,headers:{{'Content-Type':'application/json'}}}});
   if(url.includes('googleapis.com/drive/v3/about')) return new Response(JSON.stringify({{user:{{displayName:'Bert',emailAddress:'bert@example.com',photoLink:''}}}}),{{status:200,headers:{{'Content-Type':'application/json'}}}});
   return new Response(JSON.stringify({{}}),{{status:200,headers:{{'Content-Type':'application/json'}}}});
 }};
 globalThis.__calls=calls;globalThis.__opened=opened;globalThis.__send=(message)=>new Promise((resolve,reject)=>{{try{{listeners.message(message,{{}},resolve);}}catch(e){{reject(e);}}}});
}})();
"""
with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,args=['--no-sandbox'],executable_path=(os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None))
  page=browser.new_page(); errors=[]; page.on('pageerror',lambda e: errors.append(str(e)))
  page.set_content('<!doctype html><html><body></body></html>'); page.add_script_tag(content=mock); page.add_script_tag(content=brain); page.add_script_tag(content=providers); page.add_script_tag(content=integrity); page.add_script_tag(content=knowledge); page.add_script_tag(content=health); page.add_script_tag(content=bg); page.wait_for_timeout(40)
  result=page.evaluate("""async()=>{
    const ghStart=await __send({type:'PC_GITHUB_OAUTH_START',clientId:'Iv1.projectconstellation'});
    const ghPoll=await __send({type:'PC_GITHUB_OAUTH_POLL'});
    const ghStatus=await __send({type:'PC_GITHUB_STATUS',verify:true});
    const repos=await __send({type:'PC_GITHUB_REPOSITORIES'});
    const providerStatus=await __send({type:'PC_PROVIDER_SESSION_STATUS',providerId:'chatgpt'});
    const providerLogin=await __send({type:'PC_PROVIDER_LOGIN_OPEN',providerId:'chatgpt'});
    const driveConnect=await __send({type:'PC_DRIVE_CONNECT'});
    const driveStatus=await __send({type:'PC_DRIVE_STATUS',verify:true});
    const ghDisconnect=await __send({type:'PC_GITHUB_OAUTH_DISCONNECT'});
    const driveDisconnect=await __send({type:'PC_DRIVE_DISCONNECT'});
    return {ghStart,ghPoll,ghStatus,repos,providerStatus,providerLogin,driveConnect,driveStatus,ghDisconnect,driveDisconnect,calls:__calls,opened:__opened};
  }""")
  print(json.dumps({'result':result,'errors':errors},sort_keys=True))
  assert result['ghStart']['ok'] and result['ghStart']['userCode']=='ABCD-EFGH'
  assert result['ghPoll']['ok'] and result['ghPoll']['state']=='connected' and result['ghPoll']['user']['login']=='bert'
  assert result['ghStatus']['connection']['connected'] and result['ghStatus']['connection']['user']['login']=='bert'
  assert result['repos']['repositories'][0]['fullName']=='bert/project-constellation'
  assert len([call for call in result['calls'] if 'login/oauth/access_token' in call['url']])==2
  assert any('grant_type=refresh_token' in call['body'] for call in result['calls'])
  assert result['providerStatus']['state']=='connected' and result['providerStatus']['source']=='open-tab'
  assert result['providerLogin']['ok'] and result['opened'][-1]=='https://chatgpt.com/'
  assert result['driveConnect']['ok'] and result['driveStatus']['connection']['connected'] and result['driveStatus']['connection']['user']['emailAddress']=='bert@example.com'
  assert result['ghDisconnect']['ok'] and not result['ghDisconnect']['connection']['connected']
  assert result['driveDisconnect']['ok']
  assert not errors
  browser.close()
