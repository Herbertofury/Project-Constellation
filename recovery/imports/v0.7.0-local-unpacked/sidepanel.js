(() => {
  'use strict';
  let dashboard = null;
  let settingsState = null;
  let providerList = [];
  let refreshTimer = 0;
  let searchTimer = 0;
  let searchRequestId = 0;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => new Intl.NumberFormat().format(Number(n || 0));
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const ago = (ms) => { const d=Date.now()-Number(ms||0); if(!ms)return 'never'; if(d<60000)return 'now'; if(d<3600000)return `${Math.floor(d/60000)}m`; if(d<86400000)return `${Math.floor(d/3600000)}h`; return `${Math.floor(d/86400000)}d`; };
  const call = (message) => chrome.runtime.sendMessage(message);
  const attentionStates = new Set(['blocked-approval','stalled','errored','auth-required','unavailable']);

  function statusBadge(status='idle'){ return `<span class="badge ${esc(status)}">${esc(status)}</span>`; }
  function openUrl(url){ if(url) chrome.tabs.create({url,active:true}); }
  function chatById(id){ return (dashboard?.chats||[]).find((chat)=>chat.id===id); }
  function providerName(id){ return providerList.find((provider)=>provider.id===id)?.name || id || 'Unknown'; }

  function renderStats(){
    const s=dashboard?.summary||{}; const attention=(dashboard?.chats||[]).filter((chat)=>attentionStates.has(chat.status)).length;
    const running=(dashboard?.chats||[]).filter((chat)=>chat.status==='running').length; $('stats').innerHTML=[['Providers',s.providers],['Projects',s.projects],['Chats',s.chats],['Running',running],['Files',s.files],['Attention',attention]].map(([key,value])=>`<div class="stat"><span>${key}</span><strong>${fmt(value)}</strong></div>`).join('');
  }

  function renderCommand(){
    const chats=dashboard?.chats||[]; const attention=chats.filter((chat)=>attentionStates.has(chat.status)).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
    const live=chats.filter((chat)=>['running','paused','waiting-user'].includes(chat.status)).sort((a,b)=>(b.lastActivityAt||b.updatedAt||0)-(a.lastActivityAt||a.updatedAt||0));
    $('liveCount').textContent=fmt(live.length);
    $('liveList').innerHTML=live.length?live.slice(0,30).map((chat)=>`<article class="item live-item"><div class="item-head"><strong>${esc(chat.title||'Untitled chat')}</strong>${statusBadge(chat.status)}</div><div class="meta">${esc(providerName(chat.providerId))} · ${esc(chat.projectName||chat.projectId||'Inbox')} · active ${ago(chat.lastActivityAt||chat.updatedAt)} ago</div><p class="excerpt">${esc(chat.statusDetail||chat.lastExcerpt||'Active work')}</p><div class="item-actions"><button data-open-chat="${esc(chat.id)}" class="primary">Open live chat</button></div></article>`).join(''):'<div class="attention-empty">No chats are currently generating, paused, or waiting for you.</div>';
    $('attentionCount').textContent=fmt(attention.length);
    $('attentionList').innerHTML=attention.length?attention.slice(0,30).map((chat)=>`<article class="item"><div class="item-head"><strong>${esc(chat.title||'Untitled chat')}</strong>${statusBadge(chat.status)}</div><div class="meta">${esc(providerName(chat.providerId))} · ${esc(chat.projectName||chat.projectId||'Inbox')} · ${ago(chat.updatedAt)}</div><p class="excerpt">${esc(chat.statusDetail||chat.lastExcerpt||'This chat needs attention.')}</p><div class="item-actions"><button data-open-chat="${esc(chat.id)}" class="primary">Open chat</button></div></article>`).join(''):'<div class="attention-empty">No blocked, stalled, errored, unavailable, or authentication-required chats.</div>';
    $('health').textContent=`${fmt(chats.length)} chats retained across ${fmt(dashboard?.summary?.providers)} providers · ${fmt(dashboard?.summary?.searchDocs)} indexed records`;
    $('searchIndexState').textContent=`${fmt(dashboard?.summary?.searchDocs)} INDEXED`; 
    const drive=dashboard?.sync?.drive||{}; const gh=dashboard?.sync?.github||{};
    const local=dashboard?.localStorage||{}; $('durability').textContent=drive.lastStatus==='verified'?`Drive verified ${ago(drive.lastSyncAt)} ago · local ${local.persisted?'persistent':'managed'}${gh.configured?' · GitHub configured':''}`:drive.oauthProvisioned?`Drive ${drive.lastStatus||'not connected'}${drive.lastSyncAt?` · last ${ago(drive.lastSyncAt)} ago`:''} · local ${local.persisted?'persistent':'managed'}`:'Local database active with unlimited storage · Google OAuth build provisioning required for automatic Drive checkpoints';

    const counts=Object.fromEntries(providerList.map((provider)=>[provider.id,chats.filter((chat)=>chat.providerId===provider.id).length]));
    $('providerCount').textContent=fmt(providerList.length);
    $('providerGrid').innerHTML=providerList.map((provider)=>{const seen=(dashboard?.providers||[]).find((entry)=>entry.id===provider.id);return `<div class="provider-chip"><div class="provider-chip-head"><strong>${esc(provider.name)}</strong><button data-open-url="${esc(provider.home)}">Open</button></div><span>${fmt(counts[provider.id])} chats · ${esc(seen?.catalogStatus||'ready')} · ${esc(seen?.catalogMode||'zero-tab')}</span></div>`;}).join('');

    const catalogCfg=settingsState?.settings?.catalog||{}; $('autoCatalog').checked=Boolean(catalogCfg.autoSweep); $('idleCatalog').checked=catalogCfg.idleOnly!==false; $('catalogInterval').value=String(catalogCfg.intervalHours||24);
    const catalog=dashboard?.catalog;
    if(!catalog){$('catalogHeadline').textContent='Idle';$('catalogDetail').textContent='Ready to sweep supported AI history.';$('catalogStatus').textContent='No catalogue run active.';$('catalogBar').style.width='0%';return;}
    $('catalogHeadline').textContent=catalog.waitingForIdle?'waiting for idle':catalog.status;
    const totalProviders=catalog.providerIds?.length||0; const providerProgress=Math.min(totalProviders,catalog.providerIndex||0); const queueLength=catalog.queueLength||0; const current=Math.min(queueLength,catalog.chatIndex||0);
    $('catalogDetail').textContent=`ZERO TAB · ${providerProgress}/${totalProviders} providers · ${fmt(catalog.captured)} fetched · ${fmt(catalog.metadataOnly)} metadata-only · ${fmt(catalog.turnsCaptured)} turns`;
    $('catalogStatus').textContent=catalog.currentProviderId?`${providerName(catalog.currentProviderId)} · ${catalog.stage} · ${current}/${queueLength}${catalog.currentUrl?` · ${catalog.currentUrl}`:''}`:`${catalog.status}`;
    const denom=Math.max(1,totalProviders); const pct=Math.min(100,((providerProgress+(catalog.stage==='capture'&&queueLength?current/queueLength:0))/denom)*100); $('catalogBar').style.width=`${pct}%`;
  }

  function searchResultButtons(result){
    const buttons=[];
    const chat=result.chatId?chatById(result.chatId):null;
    if(chat?.url) buttons.push(`<button data-open-url="${esc(chat.url)}" class="primary">Open chat</button>`);
    if(result.url && result.entityType==='file') buttons.push(`<button data-open-url="${esc(result.url)}">Open file</button>`);
    return buttons.join('');
  }

  async function runUniversalSearch(){
    const query=$('universalSearch').value.trim();
    const target=$('universalSearchResults');
    if(!query){target.innerHTML='';target.classList.remove('open');return;}
    const id=++searchRequestId;
    target.classList.add('open');
    target.innerHTML='<div class="search-wait">Searching local full-text index…</div>';
    const response=await call({type:'PC_BRAIN_SEARCH',query,limit:80}).catch((error)=>({ok:false,error:error.message}));
    if(id!==searchRequestId)return;
    if(!response?.ok){target.innerHTML=`<div class="search-wait">${esc(response?.error||'Search failed')}</div>`;return;}
    const results=response.results||[];
    target.innerHTML=results.length?results.map((result)=>`<article class="search-hit"><div class="item-head"><strong>${esc(result.title||result.entityType)}</strong><span class="badge">${esc(result.entityType)}</span></div><div class="meta">${esc(providerName(result.providerId))}${result.chatId?` · ${esc(result.chatId)}`:''} · ${ago(result.updatedAt)}</div><p class="excerpt">${esc(result.excerpt||'')}</p><div class="item-actions">${searchResultButtons(result)}</div></article>`).join(''):'<div class="search-wait">No indexed matches.</div>';
  }

  function scheduleUniversalSearch(){
    if(searchTimer)clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>{searchTimer=0;runUniversalSearch();},160);
  }

  function renderChats(){
    const q=$('chatSearch').value.trim().toLowerCase(); const filter=$('statusFilter').value;
    const files=dashboard?.files||[]; const fileCounts={}; for(const file of files) fileCounts[file.chatId]=(fileCounts[file.chatId]||0)+1;
    const rows=(dashboard?.chats||[]).filter((chat)=>(!filter||chat.status===filter)&&(!q||`${chat.title||''} ${chat.projectName||''} ${chat.projectId||''} ${chat.providerId||''} ${chat.lastExcerpt||''} ${chat.statusDetail||''}`.toLowerCase().includes(q)));
    $('chatList').innerHTML=rows.slice(0,600).map((chat)=>`<article class="item"><div class="item-head"><strong>${esc(chat.title||'Untitled chat')}</strong>${statusBadge(chat.status||'idle')}</div><div class="meta">${esc(providerName(chat.providerId))} · ${esc(chat.projectName||chat.projectId||'Inbox')} · ${fmt(fileCounts[chat.id])} files · ${ago(chat.updatedAt)}</div><p class="excerpt">${esc(chat.statusDetail||chat.lastExcerpt||chat.url||'')}</p><div class="item-actions"><button data-open-chat="${esc(chat.id)}" class="primary">Open chat</button>${chat.url?`<button data-copy-url="${esc(chat.url)}">Copy link</button>`:''}</div></article>`).join('')||'<div class="attention-empty">No matching chats.</div>';
  }

  function renderProjects(){
    const chats=dashboard?.chats||[];
    const projects=(dashboard?.projects||[]).map((project)=>({...project,chats:chats.filter((chat)=>chat.projectId===project.id)})).sort((a,b)=>b.chats.length-a.chats.length);
    $('projectList').innerHTML=projects.length?projects.map((project)=>{const attention=project.chats.filter((chat)=>attentionStates.has(chat.status)).length;return `<article class="project-card"><strong>${esc(project.name||project.id)}</strong><span>${fmt(project.chats.length)} chats · ${fmt(attention)} need attention · ${esc(providerName(project.providerId))}</span></article>`;}).join(''):'<div class="attention-empty">Projects will appear as providers expose project/workspace groupings.</div>';
  }

  function fileButtons(file){
    const chat=chatById(file.chatId); const buttons=[];
    if(chat?.url) buttons.push(`<button data-open-url="${esc(chat.url)}" class="primary">Open chat</button>`);
    if(file.externalUrl||file.href) buttons.push(`<button data-open-url="${esc(file.externalUrl||file.href)}">${file.externalProvider==='google-drive'||file.kind==='google-drive'?'Open Drive':'Open file'}</button>`);
    return buttons.join('');
  }

  function renderFiles(){
    const q=$('fileSearch').value.trim().toLowerCase(); const rows=(dashboard?.files||[]).filter((file)=>!q||`${file.name||''} ${file.kind||''} ${file.href||''} ${file.externalProvider||''}`.toLowerCase().includes(q));
    $('fileList').innerHTML=rows.slice(0,700).map((file)=>`<article class="item"><div class="item-head"><strong>${esc(file.name||'File')}</strong><span class="badge">${esc(file.kind||'file')}</span></div><div class="meta">${esc(providerName(file.providerId))} · chat ${esc(file.chatId||'unknown')} · ${ago(file.updatedAt)}</div><p class="excerpt">${esc(file.externalUrl||file.href||file.sourcePage||file.source||'')}</p><div class="item-actions">${fileButtons(file)}</div></article>`).join('')||'<div class="attention-empty">No matching captured files.</div>';
  }

  function renderEvents(){
    $('eventList').innerHTML=(dashboard?.events||[]).slice(0,500).map((event)=>{const chat=chatById(event.chatId);return `<article class="item"><div class="item-head"><strong>${esc(event.type)}</strong><span class="badge">${ago(event.updatedAt)}</span></div><div class="meta">${esc(event.entityType)} · ${esc(event.chatId||event.entityId||'')}</div>${chat?.url?`<div class="item-actions"><button data-open-url="${esc(chat.url)}">Open related chat</button></div>`:''}</article>`;}).join('')||'<div class="attention-empty">No activity recorded yet.</div>';
  }

  function renderSync(){
    const drive=dashboard?.sync?.drive||settingsState?.settings?.drive||{}; const oauthProvisioned=Boolean(drive.oauthProvisioned||settingsState?.drive?.oauthProvisioned);
    $('driveAutoSync').checked=Boolean(drive.autoSync);
    $('driveBadge').textContent=(drive.lastStatus||'not-connected').toUpperCase();
    $('driveStatus').textContent=drive.lastError?drive.lastError:drive.lastSyncAt?`Last verified checkpoint ${new Date(drive.lastSyncAt).toLocaleString()}${drive.lastRestoreAt?` · last restore ${new Date(drive.lastRestoreAt).toLocaleString()}`:''}`:'No Drive checkpoint yet.';
    const extensionId=chrome.runtime.id;
    $('oauthSetup').innerHTML=oauthProvisioned?`Google OAuth is provisioned for this build. Extension ID: <code>${esc(extensionId)}</code>`:`Google Drive sync code is installed, but this unpacked build still needs a Google Cloud <strong>Chrome Extension</strong> OAuth client bound to extension ID <code>${esc(extensionId)}</code>. Build with <code>PROJECT_CONSTELLATION_GOOGLE_CLIENT_ID</code> to activate OAuth.`;
    $('openDrive').disabled=!drive.snapshotFileId;

    const github=settingsState?.settings?.github||dashboard?.sync?.github||{};
    $('ghOwner').value=github.owner||''; $('ghRepo').value=github.repo||''; $('ghBranch').value=github.branch||'main'; $('ghPath').value=github.path||'.project-constellation/constellation.json';
    $('ghToken').placeholder=settingsState?.hasGithubToken?'Saved token ••••••••':'Fine-grained token';
  }

  function renderAll(){ renderStats(); renderCommand(); renderChats(); renderProjects(); renderFiles(); renderEvents(); renderSync(); $('subtitle').textContent=`Catalog refreshed ${new Date(dashboard.exportedAt).toLocaleTimeString()}`; }

  async function load(){
    const [dashResponse, settingsResponse, providersResponse]=await Promise.all([call({type:'PC_BRAIN_DASHBOARD'}),call({type:'PC_BRAIN_SETTINGS_GET'}),call({type:'PC_PROVIDER_LIST'})]);
    if(!dashResponse?.ok) throw new Error(dashResponse?.error||'Dashboard failed');
    dashboard=dashResponse.dashboard; settingsState=settingsResponse?.ok?settingsResponse:null; providerList=providersResponse?.providers||[];
    renderCatalogProviderChoices(); renderAll();
  }

  function renderCatalogProviderChoices(){
    const existing=new Set([...document.querySelectorAll('#catalogProviders input:checked')].map((input)=>input.value));
    $('catalogProviders').innerHTML=providerList.map((provider)=>`<label><input type="checkbox" value="${esc(provider.id)}" ${existing.size?(existing.has(provider.id)?'checked':''):'checked'}>${esc(provider.name)}</label>`).join('');
  }

  function selectedProviderIds(){ return [...document.querySelectorAll('#catalogProviders input:checked')].map((input)=>input.value); }
  async function updateSettings(patch){ const response=await call({type:'PC_BRAIN_SETTINGS_SET',settings:patch}); if(!response?.ok) throw new Error(response?.error||'Settings update failed'); settingsState={...(settingsState||{}),settings:response.settings}; }
  async function requestDriveOrigin(){ return chrome.permissions.request({origins:['https://www.googleapis.com/*']}); }

  document.querySelectorAll('#tabs button').forEach((button)=>button.addEventListener('click',()=>{$('universalSearchResults').classList.remove('open');document.querySelectorAll('#tabs button').forEach((entry)=>entry.classList.toggle('active',entry===button));document.querySelectorAll('.view').forEach((view)=>view.classList.toggle('active',view.id===button.dataset.tab));}));
  $('openHome').addEventListener('click',()=>openUrl(chrome.runtime.getURL('home.html')));
  $('refresh').addEventListener('click',()=>load().catch((error)=>$('subtitle').textContent=error.message));
  $('universalSearch').addEventListener('input',scheduleUniversalSearch);
  $('universalSearch').addEventListener('keydown',(event)=>{if(event.key==='Escape'){$('universalSearch').value='';$('universalSearchResults').innerHTML='';$('universalSearchResults').classList.remove('open');}});
  $('chatSearch').addEventListener('input',renderChats); $('statusFilter').addEventListener('change',renderChats); $('fileSearch').addEventListener('input',renderFiles);

  document.body.addEventListener('click',(event)=>{
    if(event.target?.closest?.('#universalSearchResults button')) $('universalSearchResults').classList.remove('open');
    const chatId=event.target?.dataset?.openChat; if(chatId){const chat=chatById(chatId);if(chat?.url)openUrl(chat.url);return;}
    const url=event.target?.dataset?.openUrl; if(url){openUrl(url);return;}
    const copy=event.target?.dataset?.copyUrl; if(copy)navigator.clipboard.writeText(copy).catch(()=>{});
  });

  $('enableDownloads').addEventListener('click',async()=>{const granted=await chrome.permissions.request({permissions:['downloads']});if(!granted){$('enableDownloads').textContent='Permission not granted';return;}await updateSettings({deepDownloadTracking:true});$('enableDownloads').textContent='Download capture enabled';});
  $('autoCatalog').addEventListener('change',async()=>{await updateSettings({catalog:{autoSweep:$('autoCatalog').checked,providerIds:selectedProviderIds()}});await load();});
  $('idleCatalog').addEventListener('change',async()=>{await updateSettings({catalog:{idleOnly:$('idleCatalog').checked}});await load();});
  $('catalogInterval').addEventListener('change',async()=>{await updateSettings({catalog:{intervalHours:Number($('catalogInterval').value)||24}});await load();});
  $('startCatalog').addEventListener('click',async()=>{const ids=selectedProviderIds();if(!ids.length){$('catalogStatus').textContent='Select at least one provider.';return;}let historyGranted=await chrome.permissions.contains({permissions:['history']}).catch(()=>false);if(!historyGranted) historyGranted=await chrome.permissions.request({permissions:['history']}).catch(()=>false);$('catalogStatus').textContent=historyGranted?'Starting zero-tab sweep with browser-history discovery…':'Starting zero-tab sweep without browser-history permission…';const response=await call({type:'PC_CATALOG_START',providerIds:ids});$('catalogStatus').textContent=response?.ok?'Zero-tab catalogue sweep started.':response?.error||'Start failed';await load();});
  $('pauseCatalog').addEventListener('click',async()=>{await call({type:'PC_CATALOG_PAUSE'});await load();});
  $('resumeCatalog').addEventListener('click',async()=>{await call({type:'PC_CATALOG_RESUME'});await load();});
  $('stopCatalog').addEventListener('click',async()=>{await call({type:'PC_CATALOG_STOP'});await load();});

  $('driveAutoSync').addEventListener('change',async()=>{await updateSettings({drive:{autoSync:$('driveAutoSync').checked}});await load();});
  $('connectDrive').addEventListener('click',async()=>{try{if(!await requestDriveOrigin()){throw new Error('Google Drive host permission was not granted.');}$('driveStatus').textContent='Opening Google authorization…';const response=await call({type:'PC_DRIVE_CONNECT'});if(!response?.ok)throw new Error(response?.error||'Google connection failed');$('driveStatus').textContent='Google Drive connected.';await load();}catch(error){$('driveStatus').textContent=error.message;}});
  $('syncDrive').addEventListener('click',async()=>{try{if(!await requestDriveOrigin())throw new Error('Google Drive host permission was not granted.');$('driveStatus').textContent='Creating verified Drive checkpoint…';const response=await call({type:'PC_DRIVE_SYNC',interactive:true});if(!response?.ok)throw new Error(response?.error||'Drive sync failed');await load();$('driveStatus').textContent=`Verified ${fmt(response.size)} bytes · ${response.sha256.slice(0,12)}…`;}catch(error){$('driveStatus').textContent=error.message;}});
  $('restoreDrive').addEventListener('click',async()=>{try{if(!await requestDriveOrigin())throw new Error('Google Drive host permission was not granted.');$('driveStatus').textContent='Downloading, verifying, and merging the durable brain…';const response=await call({type:'PC_DRIVE_RESTORE',interactive:true});if(!response?.ok)throw new Error(response?.error||'Drive restore failed');await load();$('driveStatus').textContent=`Recovered verified snapshot · ${fmt(response.size)} bytes · ${response.sha256.slice(0,16)}…`;}catch(error){$('driveStatus').textContent=error.message;}});
  $('storageHealth').addEventListener('click',async()=>{const response=await call({type:'PC_STORAGE_HEALTH'});if(!response?.ok)return;$('driveStatus').textContent=`Local brain: ${response.storage.persisted?'persistent origin':'browser-managed origin'} · ${response.storage.unlimitedStorage?'unlimitedStorage enabled':'standard quota'} · ${fmt(response.storage.usage)} bytes used`;});
  $('verifyDrive').addEventListener('click',async()=>{try{if(!await requestDriveOrigin())throw new Error('Google Drive host permission was not granted.');$('driveStatus').textContent='Uploading and round-trip verifying remote bytes…';const response=await call({type:'PC_DRIVE_SYNC',interactive:true,forceRoundtrip:true});if(!response?.ok)throw new Error(response?.error||'Drive verification failed');await load();$('driveStatus').textContent=`Round-trip SHA-256 verified · ${response.sha256.slice(0,16)}…`;}catch(error){$('driveStatus').textContent=error.message;}});
  $('openDrive').addEventListener('click',()=>{const drive=dashboard?.sync?.drive||{};if(drive.snapshotFileId)openUrl(`https://drive.google.com/file/d/${drive.snapshotFileId}/view`);});

  $('saveGithub').addEventListener('click',async()=>{const granted=await chrome.permissions.request({origins:['https://api.github.com/*']});if(!granted){$('syncStatus').textContent='GitHub host permission not granted.';return;}const patch={github:{owner:$('ghOwner').value.trim(),repo:$('ghRepo').value.trim(),branch:$('ghBranch').value.trim()||'main',path:$('ghPath').value.trim()||'.project-constellation/constellation.json'}};const response=await call({type:'PC_BRAIN_SETTINGS_SET',settings:patch,githubToken:$('ghToken').value.trim()});$('ghToken').value='';$('syncStatus').textContent=response?.ok?'GitHub connection saved.':response?.error||'Save failed';await load();});
  $('syncGithub').addEventListener('click',async()=>{try{if(!await chrome.permissions.request({origins:['https://api.github.com/*']}))throw new Error('GitHub host permission not granted.');const patch={github:{owner:$('ghOwner').value.trim(),repo:$('ghRepo').value.trim(),branch:$('ghBranch').value.trim()||'main',path:$('ghPath').value.trim()||'.project-constellation/constellation.json'}};await call({type:'PC_BRAIN_SETTINGS_SET',settings:patch,githubToken:$('ghToken').value.trim()});$('ghToken').value='';$('syncStatus').textContent='Publishing repository snapshot…';const response=await call({type:'PC_GITHUB_SYNC'});if(!response?.ok)throw new Error(response?.error||'Sync failed');$('syncStatus').textContent=`Synced commit ${response.commit.slice(0,10)}`;await load();}catch(error){$('syncStatus').textContent=error.message;}});

  $('exportBrain').addEventListener('click',async()=>{const response=await call({type:'PC_BRAIN_SNAPSHOT'});if(!response?.ok)return;const blob=new Blob([JSON.stringify(response.snapshot,null,2)+'\n'],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`Project-Constellation-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});
  $('clearBrain').addEventListener('click',async()=>{if(!$('clearBrain').dataset.confirm){$('clearBrain').dataset.confirm='1';$('clearBrain').textContent='Click again to confirm';setTimeout(()=>{delete $('clearBrain').dataset.confirm;$('clearBrain').textContent='Clear local catalog';},3500);return;}await call({type:'PC_BRAIN_CLEAR'});delete $('clearBrain').dataset.confirm;$('clearBrain').textContent='Clear local catalog';await load();});

  load().catch((error)=>$('subtitle').textContent=error.message);
  refreshTimer=setInterval(()=>{if(document.visibilityState==='visible')load().catch(()=>{});},8000);
  window.addEventListener('pagehide',()=>{if(refreshTimer)clearInterval(refreshTimer);if(searchTimer)clearTimeout(searchTimer);},{once:true});
})();
