'use strict';
(() => {
  const api = window.commanderShell, $ = id => document.getElementById(id);
  if (!api) return;
  const screens = {workspace:['workspace-panel','terminal-panel'],terminal:['terminal-panel'],desktop:['desktop-panel'],activity:['activity-panel'],connections:['connections-panel'],settings:['settings-panel'],tools:['tools-panel'],access:[],chat:[]};
  const titles = {chat:'ChatGPT',workspace:'Workspace',terminal:'Terminal',desktop:'Desktop',activity:'Activity',connections:'Connections',settings:'Settings',tools:'Tools',access:'Computer access'};
  const descriptions = {workspace:'Browse, edit and run. Your conversation stays right where you left it.',terminal:'Real commands. Live output. Full control over your processes.',desktop:'A fresh view of your screen, only when you ask for it.',activity:'What ran, what finished, and what needs your attention.',connections:'Your online chat and local computer, clearly connected.',settings:'Make this workspace yours.',tools:'Every available local tool, without memorizing JSON.',access:'Choose what this computer can do for your chat.'};
  const allPanels = [...new Set(Object.values(screens).flat())];
  let view='chat', snapshot=null, tools=[], changing=false, toastTimer, palettePrior='chat', pref={theme:'system',chatZoom:1,alwaysOnTop:false};
  const themeMedia=matchMedia('(prefers-color-scheme: dark)');
  function toast(text,bad=false){$('toast').textContent=String(text);$('toast').classList.remove('hidden');$('toast').classList.toggle('error-text',bad);clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),5500);}
  function appearance(p){pref={...pref,...p};document.documentElement.dataset.theme=pref.theme==='system'?(themeMedia.matches?'dark':'light'):pref.theme;$('theme').value=pref.theme;$('chat-zoom').value=String(pref.chatZoom);$('pin-window').setAttribute('aria-pressed',String(pref.alwaysOnTop));$('pin-window').classList.toggle('selected',pref.alwaysOnTop);}
  themeMedia.addEventListener('change',()=>appearance(pref));
  async function navigate(next){
    if(!(next in screens))return;
    if(changing)return;
    changing=true;
    try{
      if(api.setView)await api.setView(next);else await api.setWorkspaceVisible(next!=='chat');
      view=next;document.body.dataset.view=next;
      $('workspace-view').classList.toggle('hidden',next==='chat'||next==='access');
      for(const id of allPanels)$(id).classList.toggle('hidden',!screens[next].includes(id));
      document.querySelectorAll('.rail-button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===next)));
      $('view-title').textContent=titles[next];document.querySelector('.online-label').textContent=next==='chat'?'WEB':'LOCAL';$('page-title').textContent=titles[next];$('page-description').textContent=descriptions[next]||'';
      $('workspace-toggle').textContent=next==='chat'?'Workspace':'ChatGPT';
      if(next!=='chat')$('workspace-view').scrollTop=0;
      window.dispatchEvent(new CustomEvent('commander-view', {detail:{view:next}}));
    }catch(e){toast(e.message,true);}finally{changing=false;}
  }
  window.commanderNavigate=navigate;
  document.querySelectorAll('[data-view]').forEach(b=>{if(b.tagName==='BUTTON')b.addEventListener('click',()=>navigate(b.dataset.view));});
  $('workspace-toggle').onclick=()=>navigate(view==='chat'?'workspace':'chat');
  $('return-chat').onclick=()=>navigate('chat');
  $('connection-open-chat').onclick=()=>navigate('chat');
  $('connection-test').onclick=async()=>{try{await navigate('chat');await api.testConnection();}catch(e){toast(e.message,true);}};
  $('connection-access').onclick=async()=>{if(innerWidth<=1050)return navigate('access');await api.setSidebarCollapsed(false);await refresh();};
  $('chat-back').onclick=()=>api.chatBack?.().catch(e=>toast(e.message,true));
  $('status-downloads').onclick=()=>navigate('activity');
  $('stop-all').onclick=async()=>{try{await api.setEmergencyLock(true);await refresh();toast('Project Constellation work stopped. Computer access is locked.');}catch(e){toast(e.message,true);}};
  async function changePref(p){try{const result=await api.setPreferences(p);appearance(result.preferences);await refresh();}catch(e){appearance(pref);toast(e.message,true);}}
  $('theme').onchange=e=>changePref({theme:e.target.value});
  $('chat-zoom').onchange=e=>changePref({chatZoom:Number(e.target.value)});
  $('pin-window').onclick=()=>changePref({alwaysOnTop:!pref.alwaysOnTop});
  $('export-diagnostics').onclick=async()=>{try{const r=await api.exportDiagnostics();if(!r.canceled)toast('Diagnostics saved. No credentials or conversation text included.');}catch(e){toast(e.message,true);}};
  $('relay-connect').onclick=async()=>{const b=$('relay-connect');b.disabled=true;try{await api.connectRemote($('relay-url').value);$('relay-status').textContent='Connecting. Approve the pairing window when it opens.';}catch(e){toast(e.message,true);$('relay-status').textContent=e.message;}finally{b.disabled=false;}};
  $('relay-disconnect').onclick=async()=>{try{await api.disconnectRemote();$('relay-status').textContent='Disconnected. No remote jobs will be accepted.';}catch(e){toast(e.message,true);}};
  const actions=[['ChatGPT','Return to your conversation','chat'],['Files','Browse and edit workspace files','workspace'],['Terminal','Run commands and manage sessions','terminal'],['Desktop','Observe screen and focus windows','desktop'],['Activity','Review tool results and downloads','activity'],['Tools','Search and run any local tool','tools'],['Connections','Check online and local connections','connections'],['Settings','Appearance, zoom and diagnostics','settings']];
  function paletteRows(){const query=$('action-query').value.toLowerCase();$('action-list').replaceChildren();for(const [title,description,destination] of actions){if(!`${title} ${description}`.toLowerCase().includes(query))continue;const b=document.createElement('button');const a=document.createElement('strong'),d=document.createElement('span');a.textContent=title;d.textContent=description;d.className='muted small';b.append(a,d);b.onclick=()=>{$('quick-actions').close();void navigate(destination);};$('action-list').append(b);}}
  async function openPalette(){if($('quick-actions').open)return;palettePrior=view;try{await api.setOverlayVisible?.(true);document.body.classList.add('palette-open');$('action-query').value='';paletteRows();$('quick-actions').showModal();$('action-query').focus();}catch(e){await api.setOverlayVisible?.(false);toast(e.message,true);}}
  $('command-palette').onclick=openPalette;$('palette-close').onclick=()=>$('quick-actions').close();$('action-query').oninput=paletteRows;
  $('action-query').onkeydown=e=>{if(e.key==='Enter'){$('action-list').querySelector('button')?.click();}if(e.key==='ArrowDown'){$('action-list').querySelector('button')?.focus();e.preventDefault();}};
  $('quick-actions').addEventListener('close',()=>{document.body.classList.remove('palette-open');void api.setOverlayVisible?.(false);});
  $('quick-actions').addEventListener('click',e=>{if(e.target===$('quick-actions')){const b=e.target.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)e.target.close();}});
  document.addEventListener('keydown',e=>{
    const mod=e.ctrlKey||e.metaKey;
    if(mod&&e.shiftKey&&e.key.toLowerCase()==='p'){e.preventDefault();void openPalette();}
    else if(mod&&e.shiftKey&&e.key.toLowerCase()==='e'){e.preventDefault();void navigate('workspace');}
    else if(mod&&e.shiftKey&&e.key.toLowerCase()==='t'){e.preventDefault();void navigate('terminal');}
    else if(mod&&e.shiftKey&&e.key.toLowerCase()==='h'){e.preventDefault();void navigate('chat');}
    else if(mod&&e.key===','){e.preventDefault();void navigate('settings');}
    else if(mod&&e.key.toLowerCase()==='s'&&view==='workspace'){e.preventDefault();$('workspace-save').click();}
    else if(mod&&e.key==='Enter'&&['terminal','workspace'].includes(view)&&e.target.id==='terminal-command'){e.preventDefault();$('terminal-run').click();}
    else if(e.key==='Escape'&&view==='access')void navigate('chat');
  });
  function renderDownloads(rows){$('downloads-list').replaceChildren();for(const item of rows||[]){const row=document.createElement('div');row.className='download-row';const info=document.createElement('div'),title=document.createElement('strong'),sub=document.createElement('small');title.textContent=item.name;sub.textContent=`${item.state} / ${(item.received/1048576).toFixed(1)} MB${item.total?' of '+(item.total/1048576).toFixed(1)+' MB':''}`;info.append(title,sub);row.append(info);if(item.state==='completed'){const b=document.createElement('button');b.textContent='Show in folder';b.onclick=()=>api.revealDownload(item.id).catch(e=>toast(e.message,true));row.append(b);}$('downloads-list').append(row);}if(!rows?.length){const p=document.createElement('p');p.className='small muted';p.textContent='No downloads in this session.';$('downloads-list').append(p);}}
  function onSnapshot(s){snapshot=s;appearance(s.ui||{});$('runtime-status').textContent=`Local runtime / ${s.toolCount||0} tools`;$('device-name').textContent=s.config?.deviceName||'This PC';$('runtime-platform').textContent=s.platform==='win32'?'Windows':s.platform||'';$('status-access').textContent=s.emergencyLock?'Locked':s.config?.allowedRoots?.includes('*')?'Full PC':`${s.config?.allowedRoots?.length||0} folder(s)`;$('bridge-status').textContent=s.emergencyLock?'Chat access: locked':s.config?.localToolMode==='off'?'Chat access: off':s.chat?.phase==='verified'?'Chat access: result delivered':s.chat?.phase==='delivery-pending'?'Result waiting - Activity':s.chat?.pageHookReady?'Chat adapter ready - unverified':'Chat access: not connected';$('connection-chat').textContent=s.chat?.lastError||s.chat?.message||'Not connected';$('connection-chat').className='badge '+(s.chat?.phase==='verified'?'good':'warn');$('connection-local').textContent=s.emergencyLock?'Locked':`${s.toolCount||0} local tools available`;$('connection-local').className='badge '+(s.emergencyLock?'bad':'good');renderDownloads(s.downloads);}
  async function refresh(){const s=await api.snapshot();window.dispatchEvent(new CustomEvent('commander-snapshot',{detail:s}));}
  window.addEventListener('commander-snapshot',e=>onSnapshot(e.detail));
  api.onEvent?.(e=>{if(e.type==='navigate')void navigate(e.detail.view);if(e.type==='open-palette')void openPalette();if(e.type==='downloads-changed')void refresh();if(e.type==='remote-state'){$('relay-status').textContent=[e.detail.phase,e.detail.code?'Pairing code: '+e.detail.code:'',e.detail.error||''].filter(Boolean).join(' / ');}});
  function form(){
    const tool=tools.find(t=>t.name===$('direct-tool').value);$('tool-fields').replaceChildren();if(!tool)return;
    let seed={};try{seed=JSON.parse($('direct-args').value);}catch{}
    for(const [key,schema] of Object.entries(tool.inputSchema?.properties||{})){
      const required=(tool.inputSchema.required||[]).includes(key),label=document.createElement('label');label.textContent=key.replaceAll('_',' ')+(required?' *':'');let input;
      if(schema.enum){input=document.createElement('select');if(!required)input.add(new Option('Default',''));for(const v of schema.enum)input.add(new Option(v,v));}
      else {input=document.createElement(schema.type==='object'||schema.type==='array'?'textarea':'input');if(schema.type==='boolean')input.type='checkbox';else if(['number','integer'].includes(schema.type))input.type='number';else input.type='text';}
      input.dataset.key=key;input.dataset.kind=schema.type||'string';input.dataset.required=String(required);input.setAttribute('aria-label',key.replaceAll('_',' '));
      if(schema.minimum!==undefined)input.min=schema.minimum;if(schema.maximum!==undefined)input.max=schema.maximum;
      const value=seed[key]??schema.default;
      if(input.type==='checkbox')input.checked=!!value;else if(value!==undefined)input.value=typeof value==='object'?JSON.stringify(value):String(value);
      input.addEventListener('input',()=>{input.dataset.touched='true';try{$('direct-args').value=JSON.stringify(formArgs(),null,2);}catch{}});
      label.append(input);if(schema.description){const small=document.createElement('small');small.textContent=schema.description;label.append(small);}$('tool-fields').append(label);
    }
  }
  function formArgs(){const args={};for(const input of $('tool-fields').querySelectorAll('[data-key]')){const k=input.dataset.key,kind=input.dataset.kind,req=input.dataset.required==='true';if(!req&&!input.dataset.touched&&!input.value)continue;if(input.type==='checkbox'){if(req||input.checked||input.dataset.touched)args[k]=input.checked;}else if(input.value!==''||req){if(['array','object'].includes(kind))args[k]=JSON.parse(input.value);else if(['integer','number'].includes(kind)){if(!input.value||!Number.isFinite(Number(input.value)))throw new Error(`Enter a number for ${k}.`);args[k]=Number(input.value);}else args[k]=input.value;}}return args;}
  $('direct-tool').addEventListener('change',()=>queueMicrotask(form));$('tool-filter').addEventListener('input',()=>queueMicrotask(form));$('direct-reset').addEventListener('click',()=>queueMicrotask(form));
  $('direct-run').addEventListener('click',e=>{if(!$('json-arguments').open){try{$('direct-args').value=JSON.stringify(formArgs(),null,2);}catch(err){e.stopImmediatePropagation();toast(err.message,true);}}},true);
  window.addEventListener('commander-tools',e=>{tools=e.detail;form();});
  window.addEventListener('unhandledrejection',e=>toast(e.reason?.message||String(e.reason),true));
  void api.listTools().then(r=>{tools=r.tools||[];form();}).catch(e=>toast(e.message,true));
  void refresh();void navigate('chat');
})();
