(() => {
  'use strict';
  let dashboard = null;
  let organization = null;
  let activeChatContext = null;
  let quickProjectDialogState = null;
  let quickProjectIconManual = false;
  let settingsState = null;
  let providerList = [];
  let connections = null;
  let scheduleRecoveryState = null;
  let desktopRuntimeStatus = null;
  let githubPollTimer = 0;
  let githubVerificationUrl = 'https://github.com/login/device';
  let refreshTimer = 0;
  let stateRefreshTimer = 0;
  let searchTimer = 0;
  let searchRequestId = 0;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => new Intl.NumberFormat().format(Number(n || 0));
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const safeUrl = (value) => { try { const url=new URL(String(value||'')); const localHttp=url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname); return url.protocol==='https:'||localHttp||url.origin===location.origin ? url.href : ''; } catch (_) { return ''; } };
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const constrainedDevice=Number(navigator.hardwareConcurrency||8)<=4||Number(navigator.deviceMemory||8)<=4;
  document.body.dataset.atmosphere=reducedMotion?'off':constrainedDevice?'static':'animated';
  const ago = (ms) => { const d=Date.now()-Number(ms||0); if(!ms)return 'never'; if(d<60000)return 'now'; if(d<3600000)return `${Math.floor(d/60000)}m`; if(d<86400000)return `${Math.floor(d/3600000)}h`; return `${Math.floor(d/86400000)}d`; };
  const call = (message) => chrome.runtime.sendMessage(message);
  const attentionStates = new Set(['blocked-approval','stalled','errored','auth-required','unavailable']);
  const projectIdentity = globalThis.ProjectConstellationProjectIdentity || { DEFAULT_ICON:'pc:folder',DEFAULT_COLOR:'#7d92ff',EMOJIS:['*'],COLORS:['#7d92ff'],VECTOR_KEYS:['folder'],normalizeIcon:(v)=>String(v||'pc:folder').slice(0,16),normalizeColor:(v,fallback='#7d92ff')=>/^#[0-9a-f]{6}$/i.test(String(v||''))?String(v).toLowerCase():fallback,semanticIcon:()=> 'pc:folder',preferredIcon:(p)=>String(p?.icon||'pc:folder'),iconMarkup:()=>'',iconDefinition:()=>null,identity:(p)=>({icon:String(p?.icon||'pc:folder'),color:/^#[0-9a-f]{6}$/i.test(String(p?.color||''))?String(p.color).toLowerCase():'#7d92ff'}) };

  function statusBadge(status='idle'){ return `<span class="badge ${esc(status)}">${esc(status)}</span>`; }
  function openUrl(url){ const trusted=safeUrl(url); if(trusted) chrome.tabs.create({url:trusted,active:true}); }
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
    if(!catalog){$('catalogHeadline').textContent='Idle';$('catalogDetail').textContent='Ready to sweep supported AI history.';$('catalogStatus').textContent='No catalogue run active.';$('catalogBar').style.width='0%';renderFullCaptureState();renderScheduledTaskGuardianState();renderApprovalRecoveryState();return;}
    $('catalogHeadline').textContent=catalog.waitingForIdle?'waiting for idle':catalog.status;
    const totalProviders=catalog.providerIds?.length||0; const providerProgress=Math.min(totalProviders,catalog.providerIndex||0); const queueLength=catalog.queueLength||0; const current=Math.min(queueLength,catalog.chatIndex||0);
    $('catalogDetail').textContent=`ZERO TAB · ${providerProgress}/${totalProviders} providers · ${fmt(catalog.captured)} fetched · ${fmt(catalog.metadataOnly)} metadata-only · ${fmt(catalog.turnsCaptured)} turns`;
    $('catalogStatus').textContent=catalog.currentProviderId?`${providerName(catalog.currentProviderId)} · ${catalog.stage} · ${current}/${queueLength}${catalog.currentUrl?` · ${catalog.currentUrl}`:''}`:`${catalog.status}`;
    const denom=Math.max(1,totalProviders); const pct=Math.min(100,((providerProgress+(catalog.stage==='capture'&&queueLength?current/queueLength:0))/denom)*100); $('catalogBar').style.width=`${pct}%`;
    renderFullCaptureState();
    renderScheduledTaskGuardianState();
    renderApprovalRecoveryState();
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

  function workspaceProjects(){ return Array.isArray(organization?.projects)?organization.projects:[]; }

  function projectIconMarkup(project){ const icon=projectIdentity.preferredIcon?projectIdentity.preferredIcon(project||{}):projectIdentity.normalizeIcon(project?.icon||projectIdentity.DEFAULT_ICON); return projectIdentity.iconMarkup?.(icon,'project-vector-icon')||esc(icon); }

  function paintProjectIcon(node,icon){ if(!node)return;node.replaceChildren();const markup=projectIdentity.iconMarkup?.(icon,'project-vector-icon')||'';if(markup)node.innerHTML=markup;else node.textContent=projectIdentity.normalizeIcon(icon); }

  function projectIdentityBadge(project, className='project-identity-chip'){
    const color=projectIdentity.normalizeColor(project?.color||projectIdentity.DEFAULT_COLOR);
    return `<span class="${className}" style="--project-color:${esc(color)}" aria-hidden="true"><span>${projectIconMarkup(project)}</span></span>`;
  }

  function renderCurrentChatProject(){
    const card=$('currentChatProjectCard'),button=$('currentChatProjectAction'),context=activeChatContext||{};
    if(!context.supported){card.dataset.state='unsupported';card.style.removeProperty('--project-color');$('currentChatProvider').textContent=context.providerId?providerName(context.providerId).toUpperCase():'NO CHAT';$('currentChatTitle').textContent=context.title||'Open a supported AI conversation';$('currentChatProject').textContent='Open a captured ChatGPT, Claude, Gemini, Grok, DeepSeek, or other supported chat to add it to a Constellation project.';button.disabled=true;button.textContent='Add to Project';return;}
    const assigned=Boolean(context.workspaceProjectId);const project=workspaceProjects().find((row)=>row.id===context.workspaceProjectId)||context.project||null;const identity=projectIdentity.identity(project||{});
    card.dataset.state=assigned?'assigned':'unassigned';if(assigned)card.style.setProperty('--project-color',identity.color);else card.style.removeProperty('--project-color');$('currentChatProvider').textContent=providerName(context.providerId).toUpperCase();$('currentChatTitle').textContent=context.title||'Untitled chat';$('currentChatProject').textContent=assigned?`In ${context.workspaceProjectName||project?.name||'a Constellation project'} - click to change or remove it.`:'Not in a Constellation project yet. Nothing is assigned until you choose a project.';button.disabled=false;button.textContent=assigned?'Change project':'Add to Project';
  }

  function renderQuickProjectChoices(){
    const query=$('quickProjectFilter').value.trim().toLowerCase();
    const current=String(activeChatContext?.workspaceProjectId||'');
    const rows=workspaceProjects().filter((project)=>!query||`${project.name||''} ${project.description||''} ${project.icon||''}`.toLowerCase().includes(query)).slice(0,160);
    $('quickProjectChoices').innerHTML=rows.length?rows.map((project)=>`<button type="button" class="quick-project-choice" data-quick-project="${esc(project.id)}" data-current="${project.id===current?'1':'0'}" style="--project-color:${esc(projectIdentity.normalizeColor(project.color))}">${projectIdentityBadge(project)}<span class="quick-project-choice-copy"><strong>${esc(project.name||'Untitled project')}</strong><span>${fmt(project.chatCount||0)} chats · ${fmt(project.fileCount||0)} files${project.attentionCount?` · ${fmt(project.attentionCount)} need attention`:''}</span></span>${project.id===current?'<span class="system-badge">CURRENT</span>':'<span class="system-badge">ADD</span>'}</button>`).join(''):'<div class="quick-project-empty">No matching projects. Create one below and this chat will be added to it immediately after your click.</div>';
  }

  function renderQuickProjectIdentity(){
    const name=$('quickProjectName').value.trim()||'New project';
    if(!quickProjectIconManual&&!$('quickProjectIcon').value.trim())$('quickProjectVectorIcon').value=projectIdentity.semanticIcon(name);
    const icon=projectIdentity.normalizeIcon($('quickProjectIcon').value.trim()||$('quickProjectVectorIcon').value||projectIdentity.semanticIcon(name)),color=projectIdentity.normalizeColor($('quickProjectColor').value);
    $('quickProjectColor').value=color;$('quickProjectColorText').value=color;paintProjectIcon($('quickProjectIdentityPreviewIcon'),icon);$('quickProjectIdentityPreviewName').textContent=name;$('quickProjectIdentityPreview').style.setProperty('--project-color',color);
    $('quickProjectVectorPalette')?.querySelectorAll('[data-project-vector]').forEach((button)=>button.classList.toggle('selected',button.dataset.projectVector===icon));
  }

  function buildQuickProjectIdentityControls(){
    $('quickProjectVectorPalette').innerHTML=projectIdentity.VECTOR_KEYS.map((key)=>{const token=`pc:${key}`,def=projectIdentity.iconDefinition?.(token);return `<button type="button" data-project-vector="${esc(token)}" title="${esc(def?.label||key)}" aria-label="Use ${esc(def?.label||key)} icon">${projectIdentity.iconMarkup?.(token,'project-vector-icon')||esc(key)}</button>`;}).join('');
    $('quickProjectEmojiPalette').innerHTML=projectIdentity.EMOJIS.map((emoji)=>`<button type="button" data-project-emoji="${esc(emoji)}" title="Use ${esc(emoji)}">${esc(emoji)}</button>`).join('');
    $('quickProjectColorPresets').innerHTML=projectIdentity.COLORS.map((color)=>`<button type="button" data-project-color="${esc(color)}" style="--swatch:${esc(color)}" title="Use ${esc(color)}" aria-label="Use project color ${esc(color)}"></button>`).join('');
  }

  function resetQuickProjectIdentity(){
    quickProjectIconManual=false;$('quickProjectIcon').value='';$('quickProjectVectorIcon').value=projectIdentity.semanticIcon('New project');$('quickProjectColor').value=projectIdentity.DEFAULT_COLOR;$('quickProjectColorText').value=projectIdentity.DEFAULT_COLOR;$('quickProjectEmojiPalette').hidden=true;renderQuickProjectIdentity();
  }

  function openQuickProjectDialog(){
    if(!activeChatContext?.supported||!activeChatContext?.chatId)return;
    quickProjectDialogState={chatId:activeChatContext.chatId,tabId:activeChatContext.tabId};
    $('quickProjectTitle').textContent=activeChatContext.workspaceProjectId?'Change project':'Add chat to a project';
    $('quickProjectMeta').textContent=`${activeChatContext.title||'Untitled chat'} · ${providerName(activeChatContext.providerId)} · Constellation will re-check this exact active tab before saving.`;
    $('quickProjectFilter').value='';$('quickProjectName').value='';$('quickProjectStatus').textContent='';$('quickProjectRemove').hidden=!activeChatContext.workspaceProjectId;resetQuickProjectIdentity();renderQuickProjectChoices();$('quickProjectDialog').showModal();setTimeout(()=>$('quickProjectFilter').focus(),0);
  }

  async function refreshPulseProjectState(){
    const [orgResponse,activeResponse]=await Promise.all([call({type:'PC_ORG_SUMMARY'}),call({type:'PC_PULSE_ACTIVE_CHAT'})]);
    if(orgResponse?.ok)organization=orgResponse.organization;
    activeChatContext=activeResponse?.ok?activeResponse.context:null;
    renderCurrentChatProject();renderProjects();
  }

  async function setQuickProject({projectId='',newProjectName='',newProjectIcon='',newProjectColor='',remove=false}={}){
    if(!quickProjectDialogState?.chatId){$('quickProjectStatus').textContent='Reopen Add to Project for the current chat.';return;}
    $('quickProjectStatus').textContent=remove?'Removing this chat from its project…':newProjectName?'Creating project and adding this chat…':'Adding this chat to the selected project…';
    const response=await call({type:'PC_PULSE_CHAT_PROJECT_SET',input:{chatId:quickProjectDialogState.chatId,tabId:quickProjectDialogState.tabId,projectId,newProjectName,newProjectIcon,newProjectColor,remove}}).catch((error)=>({ok:false,error:error.message}));
    if(!response?.ok){$('quickProjectStatus').textContent=response?.error||'Project assignment failed.';return;}
    activeChatContext=response.result?.context||activeChatContext;
    // The assignment itself is authoritative. Release the modal immediately so a slower
    // organization-summary refresh can never leave the rest of the side panel blocked.
    // The summary reconciliation continues after close and refreshes project counts/cards.
    $('quickProjectStatus').textContent=remove?'Removed from the project.':response.result?.created?`Created ${response.result.project?.name||'project'} and added this chat.`:`Added to ${response.result.project?.name||'project'}.`;
    renderCurrentChatProject();
    if($('quickProjectDialog').open)$('quickProjectDialog').close();
    const orgResponse=await call({type:'PC_ORG_SUMMARY'}).catch(()=>null);if(orgResponse?.ok)organization=orgResponse.organization;
    renderCurrentChatProject();renderProjects();
  }

  function renderProjects(){
    const userProjects=workspaceProjects();
    const providerProjects=(dashboard?.projects||[]).slice(0,60);
    const userHtml=userProjects.map((project)=>`<article class="project-card workspace-project-card" style="--project-color:${esc(projectIdentity.normalizeColor(project.color))}"><div class="item-head"><strong class="project-title-with-identity">${projectIdentityBadge(project,'project-identity-chip small')}<span>${esc(project.name||project.id)}</span></strong><span class="system-badge">PROJECT</span></div><span>${fmt(project.chatCount||0)} chats · ${fmt(project.fileCount||0)} files · ${fmt(project.attentionCount||0)} need attention</span><div class="item-actions"><button data-quick-assign-project="${esc(project.id)}" ${activeChatContext?.workspaceProjectId===project.id?'disabled':''}>${activeChatContext?.workspaceProjectId===project.id?'Current project':'Add current chat'}</button></div></article>`).join('');
    const providerHtml=providerProjects.map((project)=>`<article class="project-card provider-project-card"><div class="item-head"><strong>${esc(project.name||project.id)}</strong><span class="system-badge">${esc(providerName(project.providerId))}</span></div><span>Provider-side grouping · read-only mirror</span></article>`).join('');
    $('projectList').innerHTML=(userHtml||providerHtml)?`${userHtml}${providerHtml}`:'<div class="attention-empty">Create your first project from the Current Chat card, then add chats to it with one click.</div>';
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
    const drive=dashboard?.sync?.drive||settingsState?.settings?.drive||{};
    const driveConnection=connections?.google||{};
    const oauthProvisioned=Boolean(driveConnection.oauthProvisioned||drive.oauthProvisioned||settingsState?.drive?.oauthProvisioned);
    const driveConnected=Boolean(driveConnection.connected);
    $('driveAutoSync').checked=Boolean(drive.autoSync);
    $('driveBadge').textContent=driveConnected?'CONNECTED':oauthProvisioned?'READY':'SETUP';
    $('driveBadge').dataset.state=driveConnected?'connected':oauthProvisioned?'ready':'setup';
    $('connectDrive').disabled=!oauthProvisioned||driveConnected;
    $('disconnectDrive').disabled=!driveConnected;
    $('syncDrive').disabled=!driveConnected;
    $('restoreDrive').disabled=!driveConnected;
    $('verifyDrive').disabled=!driveConnected;
    const who=driveConnection.user?.emailAddress||driveConnection.user?.displayName||'';
    $('driveStatus').textContent=driveConnection.error||drive.lastError||(driveConnected?`Connected${who?` as ${who}`:''}${drive.lastSyncAt?` · last checkpoint ${new Date(drive.lastSyncAt).toLocaleString()}`:''}`:drive.lastSyncAt?`Last verified checkpoint ${new Date(drive.lastSyncAt).toLocaleString()}`:'No Drive checkpoint yet.');
    const extensionId=chrome.runtime.id;
    $('oauthSetup').innerHTML=oauthProvisioned?`Google OAuth is provisioned for this build. Extension ID: <code>${esc(extensionId)}</code>`:`Google Drive support is wired, but this build has no Google Cloud <strong>Chrome Extension</strong> OAuth client for extension ID <code>${esc(extensionId)}</code>. Build with <code>PROJECT_CONSTELLATION_GOOGLE_CLIENT_ID</code>; the button stays disabled instead of pretending to connect.`;
    $('openDrive').disabled=!drive.snapshotFileId;

    const github=settingsState?.settings?.github||dashboard?.sync?.github||{};
    const ghConnection=connections?.github||{};
    $('githubBadge').textContent=ghConnection.connected?'CONNECTED':ghConnection.pending?'VERIFY':'OFFLINE';
    $('githubBadge').dataset.state=ghConnection.connected?'connected':ghConnection.pending?'pending':'offline';
    $('ghOauthClientId').value=github.clientId||ghConnection.clientId||'';
    $('ghOwner').value=github.owner||''; $('ghRepo').value=github.repo||''; $('ghBranch').value=github.branch||'main'; $('ghPath').value=github.path||'.project-constellation/constellation.json';
    $('ghToken').placeholder=settingsState?.hasGithubToken?'Saved fallback token ••••••••':'Optional fallback token';
    $('connectGithub').disabled=Boolean(ghConnection.connected);
    $('disconnectGithub').disabled=!ghConnection.connected&&!settingsState?.hasGithubToken;
    $('loadGithubRepos').disabled=!ghConnection.connected&&!settingsState?.hasGithubToken;
    $('syncGithub').disabled=(!ghConnection.connected&&!settingsState?.hasGithubToken)||!github.owner||!github.repo;
    $('ghOauthFlow').hidden=!ghConnection.pending;
    if(ghConnection.pending){$('ghUserCode').textContent=ghConnection.pending?.userCode||'Check GitHub'; githubVerificationUrl=ghConnection.pending?.verificationUri||githubVerificationUrl;}
    $('syncStatus').textContent=ghConnection.error|| (ghConnection.connected?`Signed in${ghConnection.user?.login?` as ${ghConnection.user.login}`:''}${github.owner&&github.repo?` · ${github.owner}/${github.repo}`:''}`:'Sign in with GitHub, then choose the repository used for the durable mirror.');
  }

  function renderAll(){ renderStats(); renderCommand(); renderChats(); renderProjects(); renderFiles(); renderEvents(); renderSync(); $('subtitle').textContent=`Catalog refreshed ${new Date(dashboard.exportedAt).toLocaleTimeString()}`; }

  async function load(){
    const [dashResponse, settingsResponse, providersResponse, connectionsResponse, orgResponse, activeResponse, recoveryResponse, desktopResponse]=await Promise.all([call({type:'PC_BRAIN_DASHBOARD'}),call({type:'PC_BRAIN_SETTINGS_GET'}),call({type:'PC_PROVIDER_LIST'}),call({type:'PC_CONNECTIONS_STATUS'}),call({type:'PC_ORG_SUMMARY'}),call({type:'PC_PULSE_ACTIVE_CHAT'}),call({type:'PC_SCHEDULE_RECOVERY_STATE'}).catch(()=>null),call({type:'PC_LOCAL_DESKTOP_STATUS'}).catch(()=>null)]);
    if(!dashResponse?.ok) throw new Error(dashResponse?.error||'Dashboard failed');
    dashboard=dashResponse.dashboard; settingsState=settingsResponse?.ok?settingsResponse:null;scheduleRecoveryState=recoveryResponse||scheduleRecoveryState;desktopRuntimeStatus=desktopResponse||desktopRuntimeStatus; providerList=providersResponse?.providers||[]; connections=connectionsResponse?.ok?connectionsResponse:null; organization=orgResponse?.ok?orgResponse.organization:null; activeChatContext=activeResponse?.ok?activeResponse.context:null;
    renderCatalogProviderChoices(); renderFullCaptureProviderChoices(); renderAll(); renderCurrentChatProject();
  }

  function renderCatalogProviderChoices(){
    const existing=new Set([...document.querySelectorAll('#catalogProviders input:checked')].map((input)=>input.value));
    $('catalogProviders').innerHTML=providerList.map((provider)=>`<label><input type="checkbox" value="${esc(provider.id)}" ${existing.size?(existing.has(provider.id)?'checked':''):'checked'}>${esc(provider.name)}</label>`).join('');
  }

  function selectedProviderIds(){ return [...document.querySelectorAll('#catalogProviders input:checked')].map((input)=>input.value); }

  function renderFullCaptureProviderChoices(){
    const existing=new Set([...document.querySelectorAll('#panelFullCaptureProviders input:checked')].map((input)=>input.value));
    $('panelFullCaptureProviders').innerHTML=providerList.map((provider)=>`<label><input type="checkbox" value="${esc(provider.id)}" ${existing.size?(existing.has(provider.id)?'checked':''):'checked'}>${esc(provider.name)}</label>`).join('');
  }
  function selectedFullCaptureProviderIds(){ return [...document.querySelectorAll('#panelFullCaptureProviders input:checked')].map((input)=>input.value); }
  function renderFullCaptureState(){
    const state=dashboard?.fullCapture;
    if(!state){$('panelFullCaptureStatus').textContent='Idle.';$('panelFullCaptureBar').style.width='0%';$('panelStartFullCapture').disabled=false;$('panelPauseFullCapture').disabled=true;$('panelStopFullCapture').disabled=true;$('panelShowFullCapture').disabled=true;return;}
    const total=Math.max(1,(state.queueLength||0)+(state.providerIds?.length||0));
    const done=(state.chatIndex||0)+(state.providerIndex||0);
    const pct=Math.max(0,Math.min(100,done/total*100));
    $('panelFullCaptureBar').style.width=`${pct}%`;
    const runner=state.runner; const progress=runner?.progress;
    $('panelFullCaptureStatus').textContent=state.paused?'Paused safely. Resume continues the current chat.':state.status==='complete'?`Complete · ${fmt(state.captured||0)} chats · ${fmt(state.turnsCaptured||0)} turns`:`${providerName(state.currentProviderId||runner?.providerId)} · ${runner?.stage||state.stage||state.status}${progress?.detail?` · ${progress.detail}`:''}`;
    const active=!['complete','cancelled','error'].includes(state.status||'');
    $('panelStartFullCapture').disabled=active;
    $('panelPauseFullCapture').disabled=!active||Boolean(state.paused);
    $('panelStopFullCapture').disabled=!active;
    $('panelShowFullCapture').disabled=!active;
  }
  function renderScheduledTaskGuardianState(){
    const cfg=dashboard?.scheduledTaskGuardian||settingsState?.settings?.scheduledTaskGuardian||{};
    const state=dashboard?.scheduledTaskGuardian?.runtime||settingsState?.scheduledTaskGuardian||{};
    const telemetry=dashboard?.scheduledTaskGuardian?.telemetry||settingsState?.scheduledTaskTelemetry||{};const counts=telemetry.counts||{};
    $('panelScheduleGuardianEnabled').checked=Boolean(cfg.enabled);
    $('panelScheduleGuardianObserve').checked=cfg.observeTaskState!==false;
    $('panelScheduleGuardianNotifications').checked=cfg.desktopNotifications!==false;
    $('panelScheduleGuardianRunAlerts').checked=cfg.notifyRunCompleted!==false;
    $('panelScheduleGuardianStateAlerts').checked=cfg.notifyStateChanges!==false;
    $('panelScheduleGuardianEmbedded').checked=cfg.keepEmbeddedWorkspace!==false;
    $('panelScheduleGuardianAutoRepair').checked=cfg.autoRepair!==false;
    $('panelScheduleGuardianCadence').value=String(cfg.cadenceMinutes||30);
    const status=String(state.status|| (cfg.enabled?'starting':'disabled'));const healthy=['embedded','heartbeat','reachable'].includes(status);
    $('panelScheduleGuardianBadge').textContent=`PREMIUM · ${cfg.enabled?(healthy?'ON':status.replace(/-/g,' ').toUpperCase()):'OFF'}`;
    $('panelScheduleGuardianBadge').dataset.state=cfg.enabled?(healthy?'connected':'pending'):'offline';
    $('panelScheduleGuardianRepair').disabled=!cfg.enabled;$('panelScheduleGuardianTest').disabled=!cfg.enabled||cfg.desktopNotifications===false;$('panelScheduleGuardianMute').disabled=!cfg.enabled||cfg.desktopNotifications===false;
    $('panelScheduleGuardianMetrics').innerHTML=[['Observed',counts.total||0],['Active',counts.active||0],['Paused',counts.paused||0],['Attention',counts.attention||0]].map(([label,value])=>`<div><small>${esc(label)}</small><strong>${fmt(value)}</strong></div>`).join('');
    const recovery=scheduleRecoveryState||{};const rc=recovery.counts||{};const sessions=Object.values(recovery.sessions||{});
    $('panelScheduleRecoveryEnabled').checked=recovery.config?.enabled!==false;$('panelScheduleRecoveryCheck').disabled=recovery.config?.enabled===false;
    $('panelScheduleRecoveryMetrics').innerHTML=[['Recovering',rc.recoverySessions??sessions.length],['Approval hold',rc.waitingApproval??sessions.filter(x=>x.status==='SECURITY_APPROVAL_REQUIRED').length],['Attention',rc.attention??0],['Desktop',desktopRuntimeStatus?.connected?'ON':'OFF']].map(([label,value])=>`<div><small>${esc(label)}</small><strong>${typeof value==='number'?fmt(value):esc(value)}</strong></div>`).join('');
    $('panelScheduleRecoveryStatus').textContent=recovery.config?.enabled===false?'Self-healing is off.':`Self-healing ${String(recovery.status||'ready').replace(/_/g,' ').toLowerCase()} · ${desktopRuntimeStatus?.connected?'desktop connected':'desktop offline; browser recovery available'}.`;
    const tasks=Array.isArray(recovery.lastTasks)?recovery.lastTasks:[];$('panelScheduleRecoveryTasks').innerHTML=tasks.length?tasks.slice(0,8).map(t=>`<div class="guardian-panel-event"><strong>${esc(t.title||'Scheduled task')}</strong><span>${t.attention?'Needs attention':t.paused?'Paused':'Observed'}${t.runId?` · ${esc(t.runId)}`:''}</span></div>`).join(''):'<div class="guardian-panel-event"><span>No scheduled tasks inspected yet.</span></div>';
    const mutedUntil=Number(telemetry.mutedUntil||0);const muted=mutedUntil>Date.now();
    $('panelScheduleGuardianStatus').textContent=cfg.enabled?`${state.title||'Guardian starting'} · ${state.detail||'Preparing Scheduled.'}${state.lastCheckedAt?` · checked ${ago(state.lastCheckedAt)}`:''}${telemetry.syncedAt?` · task state ${ago(telemetry.syncedAt)}`:''}${muted?` · popups muted until ${new Date(mutedUntil).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`:''}`:'Guardian is off. It never creates an inactive or minimized ChatGPT browser tab.';
    const events=Array.isArray(telemetry.events)?telemetry.events.slice(0,3):[];
    $('panelScheduleGuardianActivity').innerHTML=events.length?events.map((event)=>`<div class="guardian-panel-event"><strong>${esc(event.title||'Scheduled Task Guardian')}</strong><span>${esc(event.message||'Scheduled state changed.')} · ${ago(event.at)}</span></div>`).join(''):'<div class="guardian-panel-event"><span>No real Scheduled transitions observed yet.</span></div>';
  }

  function renderApprovalRecoveryState(){
    const cfg=dashboard?.approvalAutopilot||settingsState?.settings?.approvalAutopilot||{};const state=dashboard?.approvalRecovery||{};
    $('panelApprovalResume').checked=cfg.autoRecoverPaused!==false;
    $('panelApprovalBadge').textContent='MANUAL';$('panelApprovalBadge').dataset.state='connected';
    const running=state.status==='running';const total=Math.max(0,Number(state.total||0));const scanned=Math.max(0,Number(state.scanned||0));$('panelApprovalBar').style.width=`${total?Math.min(100,scanned/total*100):state.status==='completed'?100:0}%`;
    document.querySelector('.approval-recovery-card')?.setAttribute('data-running',running?'1':'0');
    $('panelFixDetected').disabled=running;$('panelFixAll').disabled=running;$('panelStopApproval').disabled=!running;
    $('panelApprovalStatus').textContent=running?`Open-tab scan · ${fmt(scanned)}/${fmt(total)} scanned · ${fmt(state.manualReview||0)} need review · ${fmt(state.resumed)} resumed`:state.status==='completed'&&state.startedAt?`Last scan · ${fmt(state.scanned)} scanned · ${fmt(state.manualReview||0)} need permission review · ${fmt(state.resumed)} resumed`:'Permission decisions stay with you. Start a scan to inspect open chats.';
  }

  async function openConnectionsHome(){ await chrome.tabs.create({url:chrome.runtime.getURL('home.html?view=connections'),active:true}); }
  async function requestGithubOrigins(){ return chrome.permissions.request({origins:['https://api.github.com/*','https://github.com/*']}); }
  async function pollGithubOAuth(){
    if(githubPollTimer)clearTimeout(githubPollTimer);
    const response=await call({type:'PC_GITHUB_OAUTH_POLL'}).catch((error)=>({ok:false,error:error.message}));
    if(!response?.ok){$('syncStatus').textContent=response?.error||'GitHub authorization failed.';return;}
    if(response.connected){$('ghOauthFlow').hidden=true;await load();return;}
    $('ghOauthFlow').hidden=false;$('ghUserCode').textContent=response.userCode||$('ghUserCode').textContent;githubVerificationUrl=response.verificationUri||githubVerificationUrl;
    const delay=Math.max(1000,Number(response.retryAfterMs||5000));githubPollTimer=setTimeout(pollGithubOAuth,delay);
  }
  async function updateSettings(patch){ const response=await call({type:'PC_BRAIN_SETTINGS_SET',settings:patch}); if(!response?.ok) throw new Error(response?.error||'Settings update failed'); settingsState={...(settingsState||{}),settings:response.settings}; }
  async function requestDriveOrigin(){ return chrome.permissions.request({origins:['https://www.googleapis.com/*']}); }

  document.querySelectorAll('#tabs button').forEach((button)=>button.addEventListener('click',()=>{$('universalSearchResults').classList.remove('open');document.querySelectorAll('#tabs button').forEach((entry)=>entry.classList.toggle('active',entry===button));document.querySelectorAll('.view').forEach((view)=>view.classList.toggle('active',view.id===button.dataset.tab));}));
  $('openHome').addEventListener('click',()=>openUrl(chrome.runtime.getURL('home.html')));
  $('openConnections').addEventListener('click',openConnectionsHome);
  $('openConnectionsFromSync').addEventListener('click',openConnectionsHome);
  $('openConnectionsFromGithub').addEventListener('click',openConnectionsHome);
  $('refresh').addEventListener('click',()=>load().catch((error)=>$('subtitle').textContent=error.message));
  $('universalSearch').addEventListener('input',scheduleUniversalSearch);
  $('universalSearch').addEventListener('keydown',(event)=>{if(event.key==='Escape'){$('universalSearch').value='';$('universalSearchResults').innerHTML='';$('universalSearchResults').classList.remove('open');}});
  $('chatSearch').addEventListener('input',renderChats); $('statusFilter').addEventListener('change',renderChats); $('fileSearch').addEventListener('input',renderFiles);
  $('currentChatProjectAction').addEventListener('click',openQuickProjectDialog);
  $('quickProjectClose').addEventListener('click',()=>$('quickProjectDialog').close());
  $('quickProjectCancel').addEventListener('click',()=>$('quickProjectDialog').close());
  $('quickProjectFilter').addEventListener('input',renderQuickProjectChoices);
  $('quickProjectCreate').addEventListener('click',()=>{const name=$('quickProjectName').value.trim();if(!name){$('quickProjectStatus').textContent='Enter a project name first.';return;}setQuickProject({newProjectName:name,newProjectIcon:projectIdentity.normalizeIcon($('quickProjectIcon').value.trim()||$('quickProjectVectorIcon').value||projectIdentity.semanticIcon(name)),newProjectColor:projectIdentity.normalizeColor($('quickProjectColor').value)});});
  $('quickProjectName').addEventListener('input',renderQuickProjectIdentity);
  $('quickProjectName').addEventListener('keydown',(event)=>{if(event.key==='Enter'){event.preventDefault();$('quickProjectCreate').click();}});
  $('quickProjectIcon').addEventListener('input',()=>{if($('quickProjectIcon').value.trim())quickProjectIconManual=true;renderQuickProjectIdentity();});
  $('quickProjectEmojiToggle').addEventListener('click',()=>{$('quickProjectEmojiPalette').hidden=!$('quickProjectEmojiPalette').hidden;});
  $('quickProjectVectorPalette').addEventListener('click',(event)=>{const token=event.target?.closest?.('[data-project-vector]')?.dataset.projectVector;if(!token)return;quickProjectIconManual=true;$('quickProjectVectorIcon').value=projectIdentity.normalizeIcon(token);$('quickProjectIcon').value='';renderQuickProjectIdentity();});
  $('quickProjectEmojiPalette').addEventListener('click',(event)=>{const emoji=event.target?.closest?.('[data-project-emoji]')?.dataset.projectEmoji;if(!emoji)return;quickProjectIconManual=true;$('quickProjectIcon').value=projectIdentity.normalizeIcon(emoji);$('quickProjectEmojiPalette').hidden=true;renderQuickProjectIdentity();});
  $('quickProjectColor').addEventListener('input',()=>{$('quickProjectColorText').value=$('quickProjectColor').value;renderQuickProjectIdentity();});
  $('quickProjectColorText').addEventListener('change',()=>{const color=projectIdentity.normalizeColor($('quickProjectColorText').value,$('quickProjectColor').value);$('quickProjectColor').value=color;$('quickProjectColorText').value=color;renderQuickProjectIdentity();});
  $('quickProjectColorPresets').addEventListener('click',(event)=>{const color=event.target?.closest?.('[data-project-color]')?.dataset.projectColor;if(!color)return;$('quickProjectColor').value=projectIdentity.normalizeColor(color);renderQuickProjectIdentity();});
  $('quickProjectRemove').addEventListener('click',()=>setQuickProject({remove:true}));
  $('quickProjectDialog').addEventListener('close',()=>{quickProjectDialogState=null;$('quickProjectStatus').textContent='';$('quickProjectEmojiPalette').hidden=true;});

  document.body.addEventListener('click',(event)=>{
    if(event.target?.closest?.('#universalSearchResults button')) $('universalSearchResults').classList.remove('open');
    const assignProject=event.target?.closest?.('[data-quick-assign-project]')?.dataset?.quickAssignProject;if(assignProject&&activeChatContext?.supported){quickProjectDialogState={chatId:activeChatContext.chatId,tabId:activeChatContext.tabId};setQuickProject({projectId:assignProject});return;}
    const choiceProject=event.target?.closest?.('[data-quick-project]')?.dataset?.quickProject;if(choiceProject){setQuickProject({projectId:choiceProject});return;}
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

  $('panelStartFullCapture').addEventListener('click',async()=>{const ids=selectedFullCaptureProviderIds();if(!ids.length){$('panelFullCaptureStatus').textContent='Select at least one provider.';return;}$('panelFullCaptureStatus').textContent='Opening one visible capture window…';const response=await call({type:'PC_FULL_CAPTURE_START',providerIds:ids,speed:$('panelFullCaptureSpeed').value});if(!response?.ok)$('panelFullCaptureStatus').textContent=response?.error||'Capture could not start.';await load();});
  $('panelShowFullCapture').addEventListener('click',async()=>{const response=await call({type:'PC_FULL_CAPTURE_SHOW'});if(!response?.ok)$('panelFullCaptureStatus').textContent=response?.error||'No capture window is active.';});
  $('panelPauseFullCapture').addEventListener('click',async()=>{await call({type:'PC_FULL_CAPTURE_PAUSE'});await load();});
  $('panelStopFullCapture').addEventListener('click',async()=>{await call({type:'PC_FULL_CAPTURE_STOP'});await load();});

  async function updateScheduledGuardianSettings(patch){const current=settingsState?.settings?.scheduledTaskGuardian||dashboard?.scheduledTaskGuardian||{};await updateSettings({scheduledTaskGuardian:{enabled:Boolean(current.enabled),observeTaskState:current.observeTaskState!==false,desktopNotifications:current.desktopNotifications!==false,notifyRunCompleted:current.notifyRunCompleted!==false,notifyStateChanges:current.notifyStateChanges!==false,keepEmbeddedWorkspace:current.keepEmbeddedWorkspace!==false,autoRepair:current.autoRepair!==false,cadenceMinutes:Number(current.cadenceMinutes||30),...patch}});await load();}
  $('panelScheduleGuardianEnabled').addEventListener('change',async()=>{await updateScheduledGuardianSettings({enabled:$('panelScheduleGuardianEnabled').checked});});
  $('panelScheduleGuardianObserve').addEventListener('change',async()=>{await updateScheduledGuardianSettings({observeTaskState:$('panelScheduleGuardianObserve').checked});});
  $('panelScheduleGuardianNotifications').addEventListener('change',async()=>{await updateScheduledGuardianSettings({desktopNotifications:$('panelScheduleGuardianNotifications').checked});});
  $('panelScheduleGuardianRunAlerts').addEventListener('change',async()=>{await updateScheduledGuardianSettings({notifyRunCompleted:$('panelScheduleGuardianRunAlerts').checked});});
  $('panelScheduleGuardianStateAlerts').addEventListener('change',async()=>{await updateScheduledGuardianSettings({notifyStateChanges:$('panelScheduleGuardianStateAlerts').checked});});
  $('panelScheduleGuardianEmbedded').addEventListener('change',async()=>{await updateScheduledGuardianSettings({keepEmbeddedWorkspace:$('panelScheduleGuardianEmbedded').checked});});
  $('panelScheduleGuardianAutoRepair').addEventListener('change',async()=>{await updateScheduledGuardianSettings({autoRepair:$('panelScheduleGuardianAutoRepair').checked});});
  $('panelScheduleGuardianCadence').addEventListener('change',async()=>{await updateScheduledGuardianSettings({cadenceMinutes:Number($('panelScheduleGuardianCadence').value)});});
  $('panelScheduleGuardianRepair').addEventListener('click',async()=>{try{$('panelScheduleGuardianRepair').disabled=true;$('panelScheduleGuardianStatus').textContent='Repairing offscreen Scheduled workspace…';const r=await call({type:'PC_SCHEDULE_GUARDIAN_REPAIR'});if(!r?.ok)throw new Error(r?.error||'Guardian repair failed.');await load();}catch(error){$('panelScheduleGuardianStatus').textContent=error.message;}finally{$('panelScheduleGuardianRepair').disabled=!settingsState?.settings?.scheduledTaskGuardian?.enabled;}});
  $('panelScheduleGuardianOpen').addEventListener('click',async()=>{const r=await call({type:'PC_SCHEDULE_GUARDIAN_OPEN'});if(!r?.ok)$('panelScheduleGuardianStatus').textContent=r?.error||'Could not open ChatGPT Scheduled.';});
  $('panelScheduleGuardianTest').addEventListener('click',async()=>{const r=await call({type:'PC_SCHEDULE_GUARDIAN_TEST_NOTIFICATION'});$('panelScheduleGuardianStatus').textContent=r?.ok?'Test popup sent.':r?.error||'Test popup failed.';});
  $('panelScheduleGuardianMute').addEventListener('click',async()=>{const r=await call({type:'PC_SCHEDULE_GUARDIAN_MUTE',minutes:60});if(r?.ok){if(dashboard?.scheduledTaskGuardian)dashboard.scheduledTaskGuardian.telemetry=r.telemetry||{};renderScheduledTaskGuardianState();}else $('panelScheduleGuardianStatus').textContent=r?.error||'Could not mute popups.';});

  async function updateApprovalSettings(patch){const current=settingsState?.settings?.approvalAutopilot||dashboard?.approvalAutopilot||{};await updateSettings({approvalAutopilot:{...current,...patch,enabled:false,acknowledged:false,alwaysAllow:false,fallbackAllowOnce:false,backgroundRecovery:false}});await load();}
  $('panelApprovalResume').addEventListener('change',async()=>{await updateApprovalSettings({autoRecoverPaused:$('panelApprovalResume').checked});});
  $('panelFixDetected').addEventListener('click',async()=>{$('panelApprovalStatus').textContent='Scanning open blocked/paused chats…';const r=await call({type:'PC_APPROVAL_RECOVERY_START',mode:'attention'});if(!r?.ok)$('panelApprovalStatus').textContent=r?.error||'Recovery failed to start.';await load();});
  $('panelFixAll').addEventListener('click',async()=>{$('panelApprovalStatus').textContent='Scanning all currently open ChatGPT chats…';const r=await call({type:'PC_APPROVAL_RECOVERY_START',mode:'all-known'});if(!r?.ok)$('panelApprovalStatus').textContent=r?.error||'Fix All failed to start.';await load();});
  $('panelStopApproval').addEventListener('click',async()=>{await call({type:'PC_APPROVAL_RECOVERY_STOP'});await load();});

  $('driveAutoSync').addEventListener('change',async()=>{await updateSettings({drive:{autoSync:$('driveAutoSync').checked}});await load();});
  $('connectDrive').addEventListener('click',async()=>{try{if(!await requestDriveOrigin()){throw new Error('Google Drive host permission was not granted.');}$('driveStatus').textContent='Opening Google authorization…';const response=await call({type:'PC_DRIVE_CONNECT'});if(!response?.ok)throw new Error(response?.error||'Google connection failed');$('driveStatus').textContent='Google Drive connected.';await load();}catch(error){$('driveStatus').textContent=error.message;}});
  $('disconnectDrive').addEventListener('click',async()=>{const response=await call({type:'PC_DRIVE_DISCONNECT'});$('driveStatus').textContent=response?.ok?'Google Drive disconnected.':response?.error||'Disconnect failed';await load();});
  $('syncDrive').addEventListener('click',async()=>{try{if(!await requestDriveOrigin())throw new Error('Google Drive host permission was not granted.');$('driveStatus').textContent='Creating verified Drive checkpoint…';const response=await call({type:'PC_DRIVE_SYNC',interactive:true});if(!response?.ok)throw new Error(response?.error||'Drive sync failed');await load();$('driveStatus').textContent=`Verified ${fmt(response.size)} bytes · ${response.sha256.slice(0,12)}…`;}catch(error){$('driveStatus').textContent=error.message;}});
  $('restoreDrive').addEventListener('click',async()=>{try{if(!await requestDriveOrigin())throw new Error('Google Drive host permission was not granted.');$('driveStatus').textContent='Downloading, verifying, and merging the durable brain…';const response=await call({type:'PC_DRIVE_RESTORE',interactive:true});if(!response?.ok)throw new Error(response?.error||'Drive restore failed');await load();$('driveStatus').textContent=`Recovered verified snapshot · ${fmt(response.size)} bytes · ${response.sha256.slice(0,16)}…`;}catch(error){$('driveStatus').textContent=error.message;}});
  $('storageHealth').addEventListener('click',async()=>{const response=await call({type:'PC_STORAGE_HEALTH'});if(!response?.ok)return;$('driveStatus').textContent=`Local brain: ${response.storage.persisted?'persistent origin':'browser-managed origin'} · ${response.storage.unlimitedStorage?'unlimitedStorage enabled':'standard quota'} · ${fmt(response.storage.usage)} bytes used`;});
  $('verifyDrive').addEventListener('click',async()=>{try{if(!await requestDriveOrigin())throw new Error('Google Drive host permission was not granted.');$('driveStatus').textContent='Uploading and round-trip verifying remote bytes…';const response=await call({type:'PC_DRIVE_SYNC',interactive:true,forceRoundtrip:true});if(!response?.ok)throw new Error(response?.error||'Drive verification failed');await load();$('driveStatus').textContent=`Round-trip SHA-256 verified · ${response.sha256.slice(0,16)}…`;}catch(error){$('driveStatus').textContent=error.message;}});
  $('openDrive').addEventListener('click',()=>{const drive=dashboard?.sync?.drive||{};if(drive.snapshotFileId)openUrl(`https://drive.google.com/file/d/${drive.snapshotFileId}/view`);});

  $('connectGithub').addEventListener('click',async()=>{try{if(!await requestGithubOrigins())throw new Error('GitHub host permission not granted.');$('syncStatus').textContent='Starting GitHub device authorization…';const response=await call({type:'PC_GITHUB_OAUTH_START',clientId:$('ghOauthClientId').value.trim()});if(!response?.ok)throw new Error(response?.error||'GitHub OAuth could not start');$('ghOauthFlow').hidden=false;$('ghUserCode').textContent=response.userCode;githubVerificationUrl=response.verificationUri||githubVerificationUrl;openUrl(githubVerificationUrl);githubPollTimer=setTimeout(pollGithubOAuth,Math.max(1000,Number(response.intervalMs||5000)));}catch(error){$('syncStatus').textContent=error.message;}});
  $('openGithubVerify').addEventListener('click',()=>openUrl(githubVerificationUrl));
  $('disconnectGithub').addEventListener('click',async()=>{if(githubPollTimer)clearTimeout(githubPollTimer);const response=await call({type:'PC_GITHUB_OAUTH_DISCONNECT'});$('syncStatus').textContent=response?.ok?'GitHub disconnected.':response?.error||'Disconnect failed';await load();});
  $('loadGithubRepos').addEventListener('click',async()=>{try{if(!await requestGithubOrigins())throw new Error('GitHub host permission not granted.');$('syncStatus').textContent='Loading repositories…';const response=await call({type:'PC_GITHUB_REPOSITORIES'});if(!response?.ok)throw new Error(response?.error||'Repository discovery failed');const repos=response.repositories||[];$('ghRepoSelect').innerHTML='<option value="">Choose repository…</option>'+repos.map((repo)=>`<option value="${esc(repo.full_name||repo.fullName||'')}" data-branch="${esc(repo.default_branch||repo.defaultBranch||'main')}">${esc(repo.full_name||repo.fullName||repo.name)}</option>`).join('');$('syncStatus').textContent=`Loaded ${fmt(repos.length)} repositories.`;}catch(error){$('syncStatus').textContent=error.message;}});
  $('ghRepoSelect').addEventListener('change',async()=>{const full=$('ghRepoSelect').value;if(!full)return;const [owner,...rest]=full.split('/');$('ghOwner').value=owner||'';$('ghRepo').value=rest.join('/');$('ghBranch').value=$('ghRepoSelect').selectedOptions[0]?.dataset?.branch||'main';await updateSettings({github:{owner:$('ghOwner').value,repo:$('ghRepo').value,branch:$('ghBranch').value,path:$('ghPath').value.trim()||'.project-constellation/constellation.json'}});await load();});
  $('saveGithub').addEventListener('click',async()=>{const granted=await chrome.permissions.request({origins:['https://api.github.com/*']});if(!granted){$('syncStatus').textContent='GitHub host permission not granted.';return;}const patch={github:{owner:$('ghOwner').value.trim(),repo:$('ghRepo').value.trim(),branch:$('ghBranch').value.trim()||'main',path:$('ghPath').value.trim()||'.project-constellation/constellation.json',clientId:$('ghOauthClientId').value.trim()}};const response=await call({type:'PC_BRAIN_SETTINGS_SET',settings:patch,githubToken:$('ghToken').value.trim()});$('ghToken').value='';$('syncStatus').textContent=response?.ok?'Advanced GitHub connection saved.':response?.error||'Save failed';await load();});
  $('syncGithub').addEventListener('click',async()=>{try{if(!await chrome.permissions.request({origins:['https://api.github.com/*']}))throw new Error('GitHub host permission not granted.');const patch={github:{owner:$('ghOwner').value.trim(),repo:$('ghRepo').value.trim(),branch:$('ghBranch').value.trim()||'main',path:$('ghPath').value.trim()||'.project-constellation/constellation.json',clientId:$('ghOauthClientId').value.trim()}};const saved=await call({type:'PC_BRAIN_SETTINGS_SET',settings:patch,githubToken:$('ghToken').value.trim()});if(!saved?.ok)throw new Error(saved?.error||'Could not save GitHub settings');$('ghToken').value='';$('syncStatus').textContent='Publishing repository snapshot…';const response=await call({type:'PC_GITHUB_SYNC'});if(!response?.ok)throw new Error(response?.error||'Sync failed');await load();$('syncStatus').textContent=`Synced commit ${(response.commit||'').slice(0,10)}`;}catch(error){$('syncStatus').textContent=error.message;}});

  $('exportBrain').addEventListener('click',async()=>{const response=await call({type:'PC_BRAIN_SNAPSHOT'});if(!response?.ok)return;const blob=new Blob([JSON.stringify(response.snapshot,null,2)+'\n'],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`Project-Constellation-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});
  $('clearBrain').addEventListener('click',async()=>{if(!$('clearBrain').dataset.confirm){$('clearBrain').dataset.confirm='1';$('clearBrain').textContent='Click again to confirm';setTimeout(()=>{delete $('clearBrain').dataset.confirm;$('clearBrain').textContent='Clear local catalog';},3500);return;}await call({type:'PC_BRAIN_CLEAR'});delete $('clearBrain').dataset.confirm;$('clearBrain').textContent='Clear local catalog';await load();});

  function scheduleStateRefresh(delay=120){
    if(document.visibilityState!=='visible')return;
    if(stateRefreshTimer)clearTimeout(stateRefreshTimer);
    stateRefreshTimer=setTimeout(()=>{stateRefreshTimer=0;load().catch(()=>{});},Math.max(40,Number(delay||0)));
  }
  chrome.runtime?.onMessage?.addListener?.((message)=>{
    if(message?.type==='PC_SCHEDULE_GUARDIAN_TELEMETRY_UPDATED'){
      if(dashboard?.scheduledTaskGuardian)dashboard.scheduledTaskGuardian.telemetry=message.telemetry||{};
      if(settingsState)settingsState.scheduledTaskTelemetry=message.telemetry||{};
      if(document.visibilityState==='visible')renderScheduledTaskGuardianState();
      return;
    }
    if(message?.type==='PC_STATE_EVENT')scheduleStateRefresh(100);
  });
  chrome.storage?.onChanged?.addListener?.((_changes,area)=>{if(area==='local')scheduleStateRefresh(140);});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')scheduleStateRefresh(0);},{passive:true});
  window.addEventListener('focus',()=>scheduleStateRefresh(0),{passive:true});

  buildQuickProjectIdentityControls();
  load().catch((error)=>$('subtitle').textContent=error.message);
  window.addEventListener('pagehide',()=>{if(refreshTimer)clearTimeout(refreshTimer);if(stateRefreshTimer)clearTimeout(stateRefreshTimer);if(searchTimer)clearTimeout(searchTimer);if(githubPollTimer)clearTimeout(githubPollTimer);},{once:true});
})();
