(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const call = (message) => chrome.runtime.sendMessage(message);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = (n) => new Intl.NumberFormat().format(Number(n || 0));
  const ago = (ms) => { const d=Date.now()-Number(ms||0); if(!ms)return 'never'; if(d<60000)return 'now'; if(d<3600000)return `${Math.floor(d/60000)}m`; if(d<86400000)return `${Math.floor(d/3600000)}h`; if(d<604800000)return `${Math.floor(d/86400000)}d`; return new Date(ms).toLocaleDateString(); };
  const link = (file) => file?.externalUrl || file?.href || '';
  const statusClass = (s) => esc(s || 'idle');
  const stableHash = (value) => {
    const text=String(value||''); let hash=2166136261;
    for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}
    return (hash>>>0).toString(36);
  };
  let home = null;
  let providers = [];
  let chatOffset = 0;
  let fileOffset = 0;
  let searchTimer = 0;
  let searchSerial = 0;
  let fullCapturePoll = 0;
  let orgChatRows = [];
  let organization = {groups:[],projects:[],providerProjects:[],smartCollections:[],tags:[],pinnedChats:[],favoriteChats:[],unassignedCount:0};
  const selectedOrgChats = new Set();
  let orgScope = { workspaceProjectId:'', groupId:'', tag:'', mode:'all', sort:'recent' };

  const VIEW_META = {
    overview:{label:'Home',icon:'i-home'}, search:{label:'Search',icon:'i-search'}, projects:{label:'Projects',icon:'i-project'},
    chats:{label:'Chats',icon:'i-chat'}, files:{label:'Artifacts',icon:'i-file'}, attention:{label:'Attention',icon:'i-alert'},
    sources:{label:'Sources',icon:'i-source'}, durability:{label:'Durability',icon:'i-shield'}
  };
  const DEFAULT_WORKBENCH = {
    primary:true, inspector:true, panel:false, focus:false, panelMax:false,
    primaryWidth:286, inspectorWidth:320, panelHeight:238,
    density:'comfortable', theme:'graphite', primarySide:'left', panelPosition:'bottom', openTabs:['overview'], activeView:'overview',
    panelTab:'activity', inspectorTab:'details'
  };
  let workbenchState={...DEFAULT_WORKBENCH};
  let savedLayouts={};
  let inspectorSelection=null;
  let commandRows=[];
  let commandIndex=0;
  let layoutSaveTimer=0;

  const layoutSnapshot=()=>({
    primary:workbenchState.primary,inspector:workbenchState.inspector,panel:workbenchState.panel,focus:workbenchState.focus,
    panelMax:workbenchState.panelMax,primaryWidth:workbenchState.primaryWidth,inspectorWidth:workbenchState.inspectorWidth,panelHeight:workbenchState.panelHeight,
    density:workbenchState.density,theme:workbenchState.theme,primarySide:workbenchState.primarySide,panelPosition:workbenchState.panelPosition,openTabs:[...workbenchState.openTabs],activeView:workbenchState.activeView,
    panelTab:workbenchState.panelTab,inspectorTab:workbenchState.inspectorTab
  });
  function persistWorkbench(immediate=false){
    if(layoutSaveTimer)clearTimeout(layoutSaveTimer);
    const save=()=>chrome.storage?.local?.set?chrome.storage.local.set({pcWorkbenchLayout:layoutSnapshot()}).catch(()=>{}):undefined;
    if(immediate)save();else layoutSaveTimer=setTimeout(save,120);
  }
  function currentView(){return workbenchState.activeView||'overview';}
  function renderEditorTabs(){
    const tabs=(workbenchState.openTabs||[]).filter((id)=>VIEW_META[id]);
    if(!tabs.length)tabs.push('overview');
    workbenchState.openTabs=tabs;
    $('editorTabs').innerHTML=tabs.map((id)=>{const meta=VIEW_META[id];return `<div class="editor-tab${id===currentView()?' active':''}" data-tab-view="${id}" role="tab" tabindex="0" aria-selected="${id===currentView()}"><svg><use href="#${meta.icon}"/></svg><span>${meta.label}</span>${tabs.length>1?`<button class="tab-close" data-close-tab="${id}" title="Close ${meta.label}"><svg><use href="#i-close"/></svg></button>`:''}</div>`;}).join('');
  }
  function renderLayoutControls(){
    document.querySelectorAll('[data-layout-toggle]').forEach((button)=>{const key=button.dataset.layoutToggle;button.classList.toggle('on',key==='focus'?workbenchState.focus:Boolean(workbenchState[key]));});
    document.querySelectorAll('button[data-density]').forEach((button)=>button.classList.toggle('on',button.dataset.density===workbenchState.density));
    document.querySelectorAll('[data-theme-choice]').forEach((button)=>button.classList.toggle('on',button.dataset.themeChoice===workbenchState.theme));
    document.querySelectorAll('[data-primary-side]').forEach((button)=>button.classList.toggle('on',button.dataset.primarySide===workbenchState.primarySide));
    document.querySelectorAll('[data-panel-position]').forEach((button)=>button.classList.toggle('on',button.dataset.panelPosition===workbenchState.panelPosition));
    $('statusDensityText').textContent=(workbenchState.density||'comfortable').replace(/^./,(c)=>c.toUpperCase());
    const select=$('savedLayoutSelect');
    const value=select.value;
    select.innerHTML='<option value="">Choose saved layout…</option>'+Object.keys(savedLayouts).sort().map((name)=>`<option value="${esc(name)}">${esc(name)}</option>`).join('');
    if(savedLayouts[value])select.value=value;
  }
  function applyWorkbenchState({persist=false}={}){
    const root=document.documentElement;
    root.style.setProperty('--primary-width',`${Math.max(190,Math.min(520,Number(workbenchState.primaryWidth)||286))}px`);
    root.style.setProperty('--inspector-width',`${Math.max(230,Math.min(560,Number(workbenchState.inspectorWidth)||320))}px`);
    root.style.setProperty('--panel-height',`${Math.max(120,Math.min(620,Number(workbenchState.panelHeight)||238))}px`);
    document.body.dataset.theme=workbenchState.theme||'graphite';
    document.body.dataset.density=workbenchState.density||'comfortable';
    document.body.classList.toggle('layout-no-primary',!workbenchState.primary);
    document.body.classList.toggle('layout-no-inspector',!workbenchState.inspector);
    document.body.classList.toggle('layout-no-panel',!workbenchState.panel);
    document.body.classList.toggle('layout-focus',Boolean(workbenchState.focus));
    document.body.classList.toggle('layout-panel-max',Boolean(workbenchState.panelMax));
    document.body.classList.toggle('primary-right',workbenchState.primarySide==='right');
    document.body.classList.toggle('panel-top',workbenchState.panelPosition==='top');
    renderEditorTabs();renderLayoutControls();renderInspector();renderBottomPanel();
    if(persist)persistWorkbench();
  }
  function openWorkbenchTab(id){
    if(!VIEW_META[id])return;
    const tabs=workbenchState.openTabs||[];
    if(!tabs.includes(id))tabs.push(id);
    workbenchState.openTabs=tabs;workbenchState.activeView=id;renderEditorTabs();persistWorkbench();
  }
  function closeWorkbenchTab(id){
    const tabs=(workbenchState.openTabs||[]).filter((tab)=>tab!==id);
    if(!tabs.length)tabs.push('overview');
    const wasActive=currentView()===id;
    workbenchState.openTabs=tabs;
    if(wasActive){workbenchState.activeView=tabs[tabs.length-1];switchView(workbenchState.activeView);}
    else{renderEditorTabs();persistWorkbench();}
  }
  function applyLayoutPreset(name){
    const presets={
      balanced:{primary:true,inspector:true,panel:false,focus:false,panelMax:false,primaryWidth:286,inspectorWidth:320,panelHeight:238},
      research:{primary:true,inspector:false,panel:true,focus:false,panelMax:false,primaryWidth:260,panelHeight:220},
      operations:{primary:true,inspector:true,panel:true,focus:false,panelMax:false,primaryWidth:260,inspectorWidth:340,panelHeight:270},
      focus:{primary:false,inspector:false,panel:false,focus:true,panelMax:false}
    };
    if(!presets[name])return;Object.assign(workbenchState,presets[name]);applyWorkbenchState({persist:true});
  }
  function toggleLayoutPopover(force){
    const node=$('layoutPopover');const show=force===undefined?node.classList.contains('hidden'):Boolean(force);node.classList.toggle('hidden',!show);if(show)renderLayoutControls();
  }
  function renderSidebarWorkspace(){
    const pinned=(organization.projects||[]).filter((p)=>p.pinned&&!p.archived).slice(0,14);
    $('sidebarPinnedProjects').innerHTML=pinned.length?pinned.map((p)=>`<button data-sidebar-project="${esc(p.id)}"><span>${esc(p.icon||'✦')}</span><span>${esc(p.name||'Untitled project')}</span><b>${fmt(p.chatCount)}</b></button>`).join(''):'<div class="sidebar-empty">Pinned projects appear here</div>';
    const smart=(organization.smartCollections||[]).filter((c)=>c.pinned).slice(0,12);
    $('sidebarSmartCollections').innerHTML=smart.length?smart.map((c)=>`<button data-sidebar-smart="${esc(c.id)}"><span>⌕</span><span>${esc(c.name||'Saved search')}</span></button>`).join(''):'<div class="sidebar-empty">Pin saved searches to keep them here</div>';
  }
  function inspectEntity(kind,id){inspectorSelection={kind,id};if(!workbenchState.inspector&&!workbenchState.focus){workbenchState.inspector=true;applyWorkbenchState({persist:true});}else renderInspector();}
  function findChat(id){return [...(home?.live||[]),...(home?.attention||[]),...(home?.recentChats||[]),...orgChatRows].find((item)=>item?.id===id)||null;}
  function findFile(id){return (home?.recentFiles||[]).find((item)=>item?.id===id)||null;}
  function inspectorWorkspaceMarkup(){
    const c=home?.counts||{};const drive=home?.sync?.drive||{};const live=home?.live||[];const attention=home?.attention||[];
    return `<section class="inspector-section"><span>Workspace</span><h3>Project Constellation</h3><dl class="inspector-kv"><dt>Chats</dt><dd>${fmt(c.chats)}</dd><dt>Projects</dt><dd>${fmt(c.projects)}</dd><dt>Artifacts</dt><dd>${fmt(c.files)}</dd><dt>Attention</dt><dd>${fmt(attention.length)}</dd><dt>Drive</dt><dd>${esc(drive.lastStatus||'local')}</dd></dl></section><section class="inspector-section"><span>Live work</span><div class="inspector-list">${live.slice(0,5).map((chat)=>`<button data-inspect-chat="${esc(chat.id)}">${esc(chat.title||'Untitled chat')} · ${esc(chat.status||'idle')}</button>`).join('')||'<div class="sidebar-empty">No active generations</div>'}</div></section>`;
  }
  function renderInspector(){
    const body=$('inspectorBody');if(!body)return;
    document.querySelectorAll('[data-inspector-tab]').forEach((b)=>b.classList.toggle('active',b.dataset.inspectorTab===workbenchState.inspectorTab));
    if(workbenchState.inspectorTab==='activity'){
      $('inspectorTitle').textContent='Activity';
      body.innerHTML=`<section class="inspector-section"><span>Needs attention</span><div class="inspector-list">${(home?.attention||[]).slice(0,12).map((chat)=>`<button data-inspect-chat="${esc(chat.id)}">${esc(chat.title||'Untitled chat')} · ${esc(chat.status||'idle')}</button>`).join('')||'<div class="sidebar-empty">Nothing needs intervention</div>'}</div></section>`;return;
    }
    if(workbenchState.inspectorTab==='links'){
      const drive=home?.sync?.drive||{},github=home?.sync?.github||{};$('inspectorTitle').textContent='Links & remotes';
      body.innerHTML=`<section class="inspector-section"><span>Durability</span><h3>Remote lineage</h3><dl class="inspector-kv"><dt>Drive</dt><dd>${esc(drive.lastStatus||'local')}</dd><dt>Last sync</dt><dd>${ago(drive.lastSyncAt)}</dd><dt>GitHub</dt><dd>${github.configured?'configured':'not configured'}</dd></dl></section><section class="inspector-section"><span>Actions</span><div class="inspector-list"><button data-view="durability">Open durability workspace</button><button data-view="sources">Open capture sources</button></div></section>`;return;
    }
    if(inspectorSelection?.kind==='chat'){
      const chat=findChat(inspectorSelection.id);if(chat){$('inspectorTitle').textContent='Chat details';body.innerHTML=`<section class="inspector-section"><span>${esc(providerName(chat.providerId))}</span><h3>${esc(chat.title||'Untitled chat')}</h3><div class="badge-row">${coverageBadge(chat.coverage)}${statusBadge(chat.status)}</div><dl class="inspector-kv"><dt>Project</dt><dd>${esc(orgChatProjectLabel(chat))}</dd><dt>Updated</dt><dd>${ago(chat.updatedAt)}</dd><dt>Status</dt><dd>${esc(chat.statusDetail||chat.status||'idle')}</dd></dl></section><section class="inspector-section"><span>Context</span><p class="snippet">${esc(chat.lastExcerpt||chat.note||chat.url||'')}</p><div class="inspector-list">${chat.url?`<button data-open-url="${esc(chat.url)}">Open exact chat</button>`:''}<button data-search-query="${esc(chat.title||'')}">Find related work</button></div></section>`;return;}
    }
    if(inspectorSelection?.kind==='file'){
      const file=findFile(inspectorSelection.id);if(file){$('inspectorTitle').textContent='Artifact details';const href=link(file);body.innerHTML=`<section class="inspector-section"><span>Artifact</span><h3>${esc(file.name||'Unnamed artifact')}</h3><dl class="inspector-kv"><dt>Provider</dt><dd>${esc(file.externalProvider||providerName(file.providerId))}</dd><dt>Updated</dt><dd>${ago(file.updatedAt)}</dd><dt>Origin chat</dt><dd>${esc(file.chatId||'unknown')}</dd></dl></section><section class="inspector-section"><span>Actions</span><div class="inspector-list">${href?`<button data-open-url="${esc(href)}">Open file</button>`:''}${file.chatId?`<button data-chat-id="${esc(file.chatId)}">Open origin chat</button>`:''}</div></section>`;return;}
    }
    if(inspectorSelection?.kind==='project'){
      const project=orgProject(inspectorSelection.id);if(project){$('inspectorTitle').textContent='Project details';body.innerHTML=`<section class="inspector-section"><span>Constellation project</span><h3>${esc(project.icon||'✦')} ${esc(project.name||'Untitled project')}</h3><p class="snippet">${esc(project.description||'Cross-provider project')}</p><dl class="inspector-kv"><dt>Group</dt><dd>${esc(groupLabel(project.groupId))}</dd><dt>Chats</dt><dd>${fmt(project.chatCount)}</dd><dt>Files</dt><dd>${fmt(project.fileCount)}</dd><dt>Attention</dt><dd>${fmt(project.attentionCount)}</dd></dl></section><section class="inspector-section"><span>Actions</span><div class="inspector-list"><button data-org-project="${esc(project.id)}">Open project</button><button data-org-edit-project="${esc(project.id)}">Edit project</button></div></section>`;return;}
    }
    $('inspectorTitle').textContent=VIEW_META[currentView()]?.label||'Workspace';body.innerHTML=inspectorWorkspaceMarkup();
  }
  function renderBottomPanel(){
    if(!$('bottomPanelBody'))return;document.querySelectorAll('[data-panel-tab]').forEach((b)=>b.classList.toggle('active',b.dataset.panelTab===workbenchState.panelTab));
    const catalog=home?.catalog||{},capture=home?.fullCapture||{},drive=home?.sync?.drive||{},github=home?.sync?.github||{};
    if(workbenchState.panelTab==='sync'){$('bottomPanelBody').innerHTML=`<article class="ops-card"><span>Google Drive</span><strong>${esc(drive.lastStatus||'Local only')}</strong><p>Last sync ${ago(drive.lastSyncAt)}. Verified checkpoints and delta journals stay off the AI page path.</p><button data-view="durability">Open durability</button></article><article class="ops-card"><span>GitHub</span><strong>${github.configured?'Mirror configured':'Optional mirror'}</strong><p>Last sync ${ago(github.lastSyncAt)}.</p></article><article class="ops-card"><span>Local brain</span><strong>${fmt(home?.counts?.turns)} indexed turns</strong><p>${fmt(home?.counts?.files)} artifacts · ${fmt(home?.counts?.chats)} chats.</p></article>`;return;}
    if(workbenchState.panelTab==='recovery'){$('bottomPanelBody').innerHTML=(home?.attention||[]).slice(0,9).map((chat)=>`<article class="ops-card"><span>${esc(chat.status||'attention')}</span><strong>${esc(chat.title||'Untitled chat')}</strong><p>${esc(chat.statusDetail||chat.lastExcerpt||'Needs intervention')}</p>${chat.url?`<button data-open-url="${esc(chat.url)}">Resolve in chat</button>`:''}</article>`).join('')||'<article class="ops-card"><span>Recovery</span><strong>Queue clear</strong><p>No blocked, stalled, errored, or authentication-required chats.</p></article>';return;}
    $('bottomPanelBody').innerHTML=`<article class="ops-card"><span>Zero-tab catalog</span><strong>${esc(catalog.status||'idle')}</strong><p>${fmt(catalog.discovered)} discovered · ${fmt(catalog.captured)} fetched · ${fmt(catalog.turnsCaptured)} turns.</p><button data-view="sources">Open sources</button></article><article class="ops-card"><span>Full Capture</span><strong>${esc(capture.status||'idle')}</strong><p>${fmt(capture.captured)} captured · ${fmt(capture.completeChats)} full · ${fmt(capture.turnsCaptured)} observed turns.</p><button data-view="sources">Open capture controls</button></article><article class="ops-card"><span>Attention</span><strong>${fmt(home?.attention?.length)} items</strong><p>Approvals, stalls, errors, auth and unavailable chats surface here.</p><button data-view="attention">Open recovery queue</button></article>`;
  }
  function renderWorkbenchStatus(){
    const c=home?.counts||{},drive=home?.sync?.drive||{},capture=home?.fullCapture||home?.catalog||{};
    const attentionCount=Number(home?.attention?.length||0);$('sidebarChatCount').textContent=fmt(c.chats);$('sidebarFileCount').textContent=fmt(c.files);$('activityAttentionDot').textContent=fmt(attentionCount);$('activityAttentionDot').hidden=attentionCount===0;$('statusCountsText').textContent=`${fmt(c.chats)} chats · ${fmt(c.files)} files`;
    $('statusBrainText').textContent=`${fmt(c.turns)} turns indexed`;$('statusDriveText').textContent=drive.lastStatus==='verified'?'Drive verified':'Drive local';$('statusCaptureText').textContent=capture.status&&capture.status!=='idle'?`Capture ${capture.status}`:'Catalog idle';
    $('workbenchSyncState').querySelector('span:last-child').textContent=drive.lastStatus==='verified'?'Drive verified':'Local';
    renderSidebarWorkspace();renderInspector();renderBottomPanel();
  }
  function commandsFor(query=''){
    const q=String(query||'').trim().toLowerCase();
    const defs=[
      ['Home','Open Constellation Home','Ctrl+1',()=>switchView('overview')],['Search everything','Open universal search','Ctrl+K',()=>switchView('search')],['Projects & Groups','Open cross-provider organizer','',()=>switchView('projects')],['Chats','Open chat library','',()=>switchView('chats')],['Artifacts','Open file library','',()=>switchView('files')],['Recovery queue','Open chats needing attention','',()=>switchView('attention')],['Sources & Import','Open capture and import controls','',()=>switchView('sources')],['Durability','Open Drive/GitHub durability','',()=>switchView('durability')],
      ['Toggle Explorer','Show or hide the primary sidebar','Ctrl+B',()=>{workbenchState.primary=!workbenchState.primary;workbenchState.focus=false;applyWorkbenchState({persist:true});}],['Toggle Inspector','Show or hide the secondary inspector','Ctrl+Alt+B',()=>{workbenchState.inspector=!workbenchState.inspector;workbenchState.focus=false;applyWorkbenchState({persist:true});}],['Toggle Operations Panel','Show or hide bottom panel','Ctrl+J',()=>{workbenchState.panel=!workbenchState.panel;workbenchState.focus=false;applyWorkbenchState({persist:true});}],['Focus Mode','Hide chrome around the active workspace','',()=>{workbenchState.focus=!workbenchState.focus;applyWorkbenchState({persist:true});}],['Balanced Layout','Apply balanced workspace preset','',()=>applyLayoutPreset('balanced')],['Research Layout','Apply research workspace preset','',()=>applyLayoutPreset('research')],['Operations Layout','Apply operations workspace preset','',()=>applyLayoutPreset('operations')],['Refresh','Refresh catalog summary','',()=>loadHome()],['Sync + verify Drive','Create a verified Drive checkpoint','',()=>$('homeDriveSync').click()],['Capture all chats','Start explicit one-window Full Capture','',()=>{$('startFullCapture').click();switchView('sources');}]
    ];
    let rows=defs.map(([title,detail,shortcut,action],index)=>({id:`cmd-${index}`,title,detail,shortcut,action}));
    if(q)rows=rows.filter((row)=>`${row.title} ${row.detail}`.toLowerCase().includes(q));
    if(q.length>1)rows.unshift({id:'search-now',title:`Search Constellation for “${query}”`,detail:'Chats, turns, projects, files and links',shortcut:'Enter',action:()=>runSearch(query)});
    return rows.slice(0,18);
  }
  function renderCommandPalette(){
    const q=$('commandInput').value;commandRows=commandsFor(q);commandIndex=Math.max(0,Math.min(commandIndex,commandRows.length-1));
    $('commandResults').innerHTML=commandRows.map((row,index)=>`<button class="command-row${index===commandIndex?' selected':''}" data-command-index="${index}"><span>›</span><span><strong>${esc(row.title)}</strong><small>${esc(row.detail)}</small></span>${row.shortcut?`<kbd>${esc(row.shortcut)}</kbd>`:''}</button>`).join('')||'<div class="sidebar-empty">No matching command</div>';
  }
  function openCommandPalette(initial=''){const node=$('commandPalette');node.classList.remove('hidden');$('commandInput').value=initial;commandIndex=0;renderCommandPalette();requestAnimationFrame(()=>$('commandInput').focus());}
  function closeCommandPalette(){$('commandPalette').classList.add('hidden');}
  async function loadWorkbenchState(){
    const data=chrome.storage?.local?.get?await chrome.storage.local.get(['pcWorkbenchLayout','pcWorkbenchSavedLayouts']).catch(()=>({})):{};
    workbenchState={...DEFAULT_WORKBENCH,...(data.pcWorkbenchLayout||{})};
    workbenchState.openTabs=Array.isArray(workbenchState.openTabs)?workbenchState.openTabs.filter((id)=>VIEW_META[id]):['overview'];
    if(!workbenchState.openTabs.length)workbenchState.openTabs=['overview'];if(!VIEW_META[workbenchState.activeView])workbenchState.activeView=workbenchState.openTabs[0];
    savedLayouts=data.pcWorkbenchSavedLayouts&&typeof data.pcWorkbenchSavedLayouts==='object'?data.pcWorkbenchSavedLayouts:{};applyWorkbenchState();
  }

  function providerName(id){ return providers.find((p)=>p.id===id)?.name || id || 'Unknown'; }
  function openUrl(url){ if(url) chrome.tabs.create({ url, active: true }); }
  function statusBadge(status){ return `<span class="status ${statusClass(status)}">${esc(status || 'idle')}</span>`; }
  function coverageBadge(coverage){
    const value=String(coverage||'observed');
    const label=value==='full-export'?'FULL ARCHIVE':value==='full-dom-walk'?'FULL CAPTURE':value==='partial-dom-walk'?'PARTIAL CAPTURE':value==='server-rendered-content'?'DEEP':value==='metadata-only'?'METADATA':value==='archived'?'ARCHIVED':'LIVE';
    return `<span class="coverage ${esc(value)}">${label}</span>`;
  }

  function switchView(id){
    if(!VIEW_META[id])return;
    workbenchState.activeView=id;openWorkbenchTab(id);
    document.querySelectorAll('.view').forEach((v)=>v.classList.toggle('active', v.id===id));
    document.querySelectorAll('#homeNav button,#activityNav button').forEach((b)=>b.classList.toggle('active', b.dataset.view===id));
    renderEditorTabs();renderInspector();persistWorkbench();
    if(id==='projects') loadProjects(true);
    if(id==='chats' && !$('chatBrowser').children.length) loadChats(true);
    if(id==='files' && !$('fileBrowser').children.length) loadFiles(true);
  }

  function workCard(chat, extra=''){
    return `<article class="work-card" data-inspect-chat="${esc(chat.id||'')}"><div class="work-head"><h3>${esc(chat.title||'Untitled chat')}</h3><div class="badge-row">${coverageBadge(chat.coverage)}${statusBadge(chat.status)}</div></div><div class="meta">${esc(providerName(chat.providerId))} · ${esc(chat.projectName||chat.projectId||'Inbox')} · ${ago(chat.updatedAt)}</div><p class="snippet">${esc(chat.statusDetail||chat.lastExcerpt||extra||chat.url||'')}</p><div class="actions">${chat.url?`<button class="primary-link" data-open-url="${esc(chat.url)}">Open exact chat</button>`:''}<button data-search-query="${esc(chat.title||'')}">Find related</button></div></article>`;
  }

  function fileCard(file){
    const href=link(file); const chatId=file.chatId||'';
    return `<article class="file-card" data-inspect-file="${esc(file.id||'')}"><h3>${esc(file.name||'Unnamed artifact')}</h3><div class="meta">${esc(file.externalProvider||providerName(file.providerId))} · ${ago(file.updatedAt)}</div><p class="snippet">${esc(file.sourcePage||file.href||file.externalUrl||'')}</p><div class="actions">${href?`<button class="primary-link" data-open-url="${esc(href)}">Open file</button>`:''}${chatId?`<button data-chat-id="${esc(chatId)}">Origin chat</button>`:''}</div></article>`;
  }

  function renderOverview(){
    const c=home?.counts||{};
    $('homeMetrics').innerHTML=[['Projects',c.projects],['Chats',c.chats],['Turns',c.turns],['Files',c.files],['Providers',c.providers]].map(([label,value])=>`<div class="metric"><small>${label}</small><strong>${fmt(value)}</strong></div>`).join('');
    const att=(home?.attention||[]); $('attentionPill').textContent=fmt(att.length); $('activityAttentionDot').textContent=fmt(att.length); $('activityAttentionDot').hidden=att.length===0;
    const live=home?.live||[];
    $('liveWork').innerHTML=live.length?live.slice(0,8).map((chat)=>workCard(chat)).join(''):'<div class="empty">Nothing is generating, paused, or waiting for you right now.</div>';
    const pinned=(home?.organization?.projects||[]).filter((p)=>p.pinned&&!p.archived).slice(0,6);
    $('pinnedProjects').innerHTML=pinned.length?pinned.map(projectCard).join(''):'<div class="empty">Pin important projects and they become your Home launchpad.</div>';
    $('recentChats').innerHTML=(home?.recentChats||[]).slice(0,9).map((chat)=>workCard(chat)).join('')||'<div class="empty">No chats catalogued yet.</div>';
    $('recentFiles').innerHTML=(home?.recentFiles||[]).slice(0,9).map(fileCard).join('')||'<div class="empty">No artifacts catalogued yet.</div>';
    $('topicCloud').innerHTML=(home?.topics||[]).map((t)=>`<button class="topic" data-search-query="${esc(t.term)}">${esc(t.term)} <b>${fmt(t.count)}</b></button>`).join('')||'<span class="empty">Topics appear as chats are indexed.</span>';
    const drive=home?.sync?.drive||{};
    $('orbLabel').textContent=drive.lastStatus==='verified'?'DRIVE':'LOCAL';
    $('orbValue').textContent=drive.lastStatus==='verified'?'VERIFIED':'SAFE';
    $('railHealth').textContent=`${fmt(c.chats)} chats indexed`;
    $('railSub').textContent=home?.discovery?.hiddenTabs===false?'Zero-tab catalog engine':'Catalog engine';
  }

  function renderAttention(){
    const rows=home?.attention||[];
    $('attentionBrowser').innerHTML=rows.length?rows.map((chat)=>`<article class="library-card attention-row"><div class="work-head"><h3>${esc(chat.title||'Untitled chat')}</h3>${statusBadge(chat.status)}</div><div class="meta">${esc(providerName(chat.providerId))} · ${esc(chat.projectName||'Inbox')} · ${ago(chat.updatedAt)}</div><p class="snippet">${esc(chat.statusDetail||chat.lastExcerpt||'This chat needs attention.')}</p><div class="actions">${chat.url?`<button class="primary-link" data-open-url="${esc(chat.url)}">Resolve in chat</button>`:''}<button data-search-query="${esc(chat.title||'')}">Find project context</button></div></article>`).join(''):'<div class="empty">No blocked, stalled, errored, authentication-required, or unavailable chats.</div>';
  }

  function renderSources(){
    const byId=Object.fromEntries((home?.recentChats||[]).map(()=>[]));
    $('sourceGrid').innerHTML=providers.map((p)=>{
      const known=(home?.recentChats||[]).filter((c)=>c.providerId===p.id).length;
      const lane=p.catalog||{};
      return `<div class="source-card"><strong>${esc(p.name)}</strong><span class="source-mode">ZERO-TAB READY</span><span>${lane.browserHistory?'History URL discovery · ':''}${lane.backgroundHtml?'Background HTML · ':''}${lane.livePassive?'Passive live capture · ':''}${lane.manualFullCapture?'Manual full capture':''}</span><span>${lane.exportImport?`Export lane: ${esc(lane.exportImport)}`:'Export lane not configured'}</span><span>${known?`${known}+ recently visible chats`:'Awaiting catalog data'}</span></div>`;
    }).join('');
    const catalog=home?.catalog;
    $('catalogHomeStatus').textContent=catalog?`${catalog.status} · ${fmt(catalog.discovered)} discovered · ${fmt(catalog.captured)} fetched · ${fmt(catalog.turnsCaptured)} turns · ${fmt(catalog.metadataOnly)} metadata-only`:'Ready. No crawler tabs will be opened.';
    $('enableHistory').textContent=home?.discovery?.browserHistoryGranted?'Browser history discovery enabled':'Enable history discovery';
  }

  function renderFullCapture(){
    const state=home?.fullCapture||null;
    const card=document.querySelector('.heavy-capture-card');
    const start=$('startFullCapture'), pause=$('pauseFullCapture'), resume=$('resumeFullCapture'), stop=$('stopFullCapture');
    if(fullCapturePoll){clearTimeout(fullCapturePoll);fullCapturePoll=0;}
    if(!state){
      if(card)card.dataset.state='idle';
      $('fullCaptureBar').style.width='0%';
      $('fullCaptureStatus').textContent='Idle. Zero-tab catalog remains the normal/default collector.';
      start.disabled=false;pause.disabled=true;resume.disabled=true;stop.disabled=true;
      return;
    }
    const providerTotal=Math.max(1,state.providerIds?.length||providers.length||1);
    const providerIndex=Math.min(providerTotal,Number(state.providerIndex||0));
    const queue=Math.max(0,Number(state.queueLength||0));
    const chatIndex=Math.min(queue,Number(state.chatIndex||0));
    const within=queue?chatIndex/queue:(state.stage==='capture'?0:state.stage==='done'?1:0);
    const pct=Math.max(0,Math.min(100,((providerIndex+within)/providerTotal)*100));
    $('fullCaptureBar').style.width=`${pct.toFixed(1)}%`;
    if(card)card.dataset.state=state.status||'idle';
    const provider=providerName(state.currentProviderId);
    const current=state.currentTitle||state.currentUrl||'';
    const parts=[String(state.status||'idle').toUpperCase(),`${fmt(state.captured)} captured`,`${fmt(state.completeChats)} full`,`${fmt(state.partialChats)} partial`,`${fmt(state.turnsCaptured)} observed turns`,`${fmt(state.filesCaptured)} files`];
    if(state.currentProviderId)parts.push(provider);
    if(queue)parts.push(`${fmt(chatIndex)} / ${fmt(queue)} in provider`);
    if(current)parts.push(current);
    if(state.errors?.length)parts.push(`${fmt(state.errors.length)} errors`);
    $('fullCaptureStatus').textContent=parts.join(' · ');
    const running=state.status==='running', paused=state.status==='paused';
    start.disabled=running||paused;pause.disabled=!running;resume.disabled=!paused;stop.disabled=!running&&!paused;
    if(running)fullCapturePoll=setTimeout(()=>loadHome().catch(()=>{}),900);
  }

  function renderDurability(){
    const drive=home?.sync?.drive||{}; const github=home?.sync?.github||{};
    $('durabilityCards').innerHTML=`
      <article class="library-card"><h3>Local brain</h3><p class="snippet">Fast IndexedDB working set with full-text index. AI pages only enqueue small incremental capture batches.</p><div class="meta">${fmt(home?.counts?.turns)} turns · ${fmt(home?.counts?.files)} files</div></article>
      <article class="library-card"><h3>Google Drive</h3><p class="snippet">${esc(drive.lastStatus||'not connected')} · asynchronous full checkpoints plus cumulative delta journal.</p><div class="meta">Last sync ${ago(drive.lastSyncAt)} · ${drive.oauthProvisioned?'OAuth provisioned':'OAuth client setup required'}</div></article>
      <article class="library-card"><h3>GitHub mirror</h3><p class="snippet">${github.configured?'Repository snapshot configured.':'Optional repository mirror not configured.'}</p><div class="meta">Last sync ${ago(github.lastSyncAt)}</div></article>`;
  }

  async function loadHome(){
    const [summary, providerResponse]=await Promise.all([call({type:'PC_HOME_SUMMARY'}),call({type:'PC_PROVIDER_LIST'})]);
    if(!summary?.ok) throw new Error(summary?.error||'Home summary failed');
    home=summary.home; providers=providerResponse?.providers||[]; organization=home?.organization||organization;
    renderOverview(); renderAttention(); renderSources(); renderFullCapture(); renderDurability(); renderWorkbenchStatus();
  }

  async function runSearch(query){
    const q=String(query||'').trim(); if(!q)return;
    $('globalSearch').value=q; switchView('search');
    const serial=++searchSerial;
    $('searchSummary').textContent=`Searching the local Constellation index for “${q}”…`;
    $('searchResults').innerHTML='<div class="empty">Searching chats, turns, projects, and files…</div>';
    const response=await call({type:'PC_HOME_SEARCH',query:q,limit:50});
    if(serial!==searchSerial)return;
    if(!response?.ok){$('searchSummary').textContent=response?.error||'Search failed';return;}
    const data=response.result||{};
    $('searchSummary').textContent=`${fmt(data.totalHits)} indexed matches grouped into ${fmt(data.groups?.length)} conversations.`;
    $('searchResults').innerHTML=(data.groups||[]).length?data.groups.map((group)=>{
      const chat=group.chat||{};
      const matches=(group.matches||[]).map((m)=>`<div class="match"><strong>${esc(m.entityType)}</strong> · ${esc(m.excerpt||m.title||'')}</div>`).join('');
      const files=(group.files||[]).filter((f)=>link(f)).map((f)=>`<a href="${esc(link(f))}" target="_blank" rel="noreferrer">${esc(f.name||f.externalProvider||'file')}</a>`).join('');
      return `<article class="search-card"><div class="work-head"><div><h3>${esc(chat.title||'Untitled chat')}</h3><div class="meta">${esc(providerName(chat.providerId))} · ${esc(chat.projectName||chat.projectId||'Inbox')} · ${ago(chat.updatedAt)}</div></div><div class="badge-row">${coverageBadge(chat.coverage)}${statusBadge(chat.status)}</div></div><div class="match-stack">${matches}</div>${files?`<div class="related-files">${files}</div>`:''}<div class="actions">${chat.url?`<button class="primary-link" data-open-url="${esc(chat.url)}">Open exact chat</button>`:''}${(group.files||[]).length?`<button data-search-query="${esc(q)}">${fmt(group.files.length)} related files</button>`:''}</div></article>`;
    }).join(''):'<div class="empty">No indexed conversations matched that search.</div>';
  }

  function toast(message){
    const node=$('orgToast'); node.textContent=String(message||''); node.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>node.classList.remove('show'),1800);
  }
  function orgProject(id){return organization.projects.find((p)=>p.id===id)||null;}
  function orgGroup(id){return organization.groups.find((g)=>g.id===id)||null;}
  function groupLabel(id){return orgGroup(id)?.name||'Ungrouped';}
  function orgChatProjectLabel(chat){return chat.workspaceProjectName||orgProject(chat.workspaceProjectId)?.name||chat.projectName||'Unassigned';}
  function setOrgScope(next={}){orgScope={...orgScope,...next}; $('orgFilter').value=orgScope.mode||'all'; $('orgSort').value=orgScope.sort||'recent'; renderOrganizationChrome(); loadOrganizerChats();}

  function renderGroupTree(){
    const groups=organization.groups||[]; const byParent=new Map();
    for(const group of groups){const parent=group.parentId||'';const list=byParent.get(parent)||[];list.push(group);byParent.set(parent,list);}
    for(const list of byParent.values())list.sort((a,b)=>Number(b.pinned||0)-Number(a.pinned||0)||(a.sortOrder||0)-(b.sortOrder||0)||(a.name||'').localeCompare(b.name||''));
    const seen=new Set();
    const walk=(parent='',depth=0)=> (byParent.get(parent)||[]).map((g)=>{if(seen.has(g.id))return '';seen.add(g.id);const active=orgScope.groupId===g.id?' active':'';return `<div class="org-tree-row${active}" data-depth="${Math.min(depth,3)}" data-org-group="${esc(g.id)}" data-group-drop="${esc(g.id)}" draggable="true"><span>${esc(g.icon||'◇')}</span><span class="org-tree-name">${esc(g.name)}</span>${g.pinned?'<span title="Pinned">⌁</span>':''}<button class="tree-edit" data-org-edit-group="${esc(g.id)}" title="Edit group">•••</button></div>${walk(g.id,depth+1)}`;}).join('');
    $('orgGroupTree').innerHTML=walk('',0)||'<div class="empty">Create groups to nest related projects.</div>';
  }

  function projectCard(project){
    const active=orgScope.workspaceProjectId===project.id?' active':''; const color=project.color||'#7d92ff';
    return `<article class="project-card${active}" style="--project-color:${esc(color)}" data-org-project="${esc(project.id)}" data-inspect-project="${esc(project.id)}" data-project-drop="${esc(project.id)}" draggable="true"><div class="mini-actions"><button data-org-project-pin="${esc(project.id)}" title="${project.pinned?'Unpin':'Pin'} project">${project.pinned?'◆':'◇'}</button><button data-org-edit-project="${esc(project.id)}" title="Edit project">•••</button></div><div class="project-icon">${esc(project.icon||'✦')}</div><h3>${esc(project.name||'Untitled project')}</h3><p>${esc(project.description||`${groupLabel(project.groupId)} · cross-provider workspace`)}</p><div class="project-stats"><span>${fmt(project.chatCount)} chats</span><span>${fmt(project.fileCount)} files</span>${project.attentionCount?`<span>${fmt(project.attentionCount)} attention</span>`:''}</div></article>`;
  }

  function orgChatCard(chat){
    const tags=(chat.tags||[]).slice(0,8).map((tag)=>`<span class="tag-chip">#${esc(tag)}</span>`).join('');
    const selected=selectedOrgChats.has(chat.id);
    return `<article class="org-chat" draggable="true" data-drag-chat="${esc(chat.id)}" data-inspect-chat="${esc(chat.id)}"><input class="select-box" type="checkbox" data-org-select-chat="${esc(chat.id)}" ${selected?'checked':''}><div class="org-chat-main"><div class="org-chat-title"><h3>${esc(chat.title||'Untitled chat')}</h3>${chat.pinned?'<span title="Pinned">◆</span>':''}${chat.favorite?'<span title="Favorite">★</span>':''}${statusBadge(chat.status)}</div><div class="meta">${esc(providerName(chat.providerId))} · ${esc(orgChatProjectLabel(chat))} · ${ago(chat.updatedAt)}</div>${tags?`<div class="tag-row">${tags}</div>`:''}<p class="snippet">${esc(chat.note||chat.lastExcerpt||chat.statusDetail||'')}</p></div><div class="org-chat-actions">${chat.url?`<button class="primary-link" data-open-url="${esc(chat.url)}">Open</button>`:''}<button class="${chat.pinned?'on':''}" data-org-chat-action="pin" data-chat-id="${esc(chat.id)}">Pin</button><button class="${chat.favorite?'on':''}" data-org-chat-action="favorite" data-chat-id="${esc(chat.id)}">★</button><button data-org-chat-action="tag" data-chat-id="${esc(chat.id)}">Tag</button><button data-org-chat-action="move" data-chat-id="${esc(chat.id)}">Move</button><button class="${chat.organizedArchived?'on':''}" data-org-chat-action="archive" data-chat-id="${esc(chat.id)}">${chat.organizedArchived?'Restore':'Archive'}</button></div></article>`;
  }

  function renderOrganizationChrome(){
    const projects=(organization.projects||[]).filter((p)=>!p.archived); $('orgWorkspaceCount').textContent=`${fmt(projects.length)} projects`;
    const quick=[['all','All chats',null],['unassigned','Unassigned',organization.unassignedCount],['pinned','Pinned',organization.pinnedChats?.length],['favorites','Favorites',organization.favoriteChats?.length],['attention','Needs attention',null],['archived','Archive',null]];
    $('orgQuickFilters').innerHTML=quick.map(([mode,label,count])=>`<button class="${orgScope.mode===mode&&!orgScope.workspaceProjectId&&!orgScope.groupId&&!orgScope.tag?'active':''}" data-org-mode="${mode}"><span>${esc(label)}</span>${count!==null?`<b>${fmt(count)}</b>`:''}</button>`).join('');
    renderGroupTree();
    $('orgSmartList').innerHTML=(organization.smartCollections||[]).map((c)=>`<div class="smart-row" data-org-smart="${esc(c.id)}"><span>${esc(c.icon||'⌕')} ${esc(c.name)}</span>${c.pinned?'<b>PIN</b>':''}<button class="tree-edit" data-org-edit-smart="${esc(c.id)}" title="Edit saved search">•••</button></div>`).join('')||'<div class="empty">Save searches you use repeatedly.</div>';
    $('orgTagCloud').innerHTML=(organization.tags||[]).slice(0,36).map((t)=>`<button data-org-tag="${esc(t.name)}">#${esc(t.name)} <b>${fmt(t.count)}</b></button>`).join('')||'<span class="empty">Tags appear here.</span>';
    let visible=projects;
    if(orgScope.groupId) visible=visible.filter((p)=>p.groupId===orgScope.groupId);
    $('orgProjectGrid').innerHTML=visible.length?visible.map(projectCard).join(''):'<div class="empty">No Constellation projects in this scope yet.</div>';
    $('providerProjectBrowser').innerHTML=(organization.providerProjects||[]).slice(0,24).map((p)=>`<article class="library-card"><h3>${esc(p.name||p.id)}</h3><div class="meta">${esc(providerName(p.providerId))} · source project</div><button data-search-query="${esc(p.name||p.id)}">Search source context</button></article>`).join('')||'<div class="empty">Provider projects appear here as captures discover them.</div>';
    const options=['<option value="">Move to: Unassigned</option>',...projects.map((p)=>`<option value="${esc(p.id)}">${esc(groupLabel(p.groupId))} / ${esc(p.name)}</option>`)].join(''); $('orgBulkProject').innerHTML=options;
    const group=orgScope.groupId?orgGroup(orgScope.groupId):null, project=orgScope.workspaceProjectId?orgProject(orgScope.workspaceProjectId):null;
    $('orgScopeTitle').textContent=project?.name||group?.name||(orgScope.tag?`#${orgScope.tag}`:orgScope.mode==='all'?'All organized chats':orgScope.mode.replace(/-/g,' '));
    $('orgScopeMeta').textContent=project?`${groupLabel(project.groupId)} · ${fmt(project.chatCount)} chats · ${fmt(project.fileCount)} files`:group?'Projects and chats in this group':'Cross-provider workspace';
    renderBulkBar();
  }

  function renderBulkBar(){const n=selectedOrgChats.size;$('orgSelectedCount').textContent=fmt(n);$('orgBulkBar').classList.toggle('hidden',!n);}

  async function loadOrganizerChats(){
    const filters={limit:180,mode:orgScope.mode,sort:orgScope.sort}; if(orgScope.workspaceProjectId)filters.workspaceProjectId=orgScope.workspaceProjectId;if(orgScope.groupId)filters.groupId=orgScope.groupId;if(orgScope.tag)filters.tag=orgScope.tag;
    const r=await call({type:'PC_ORG_CHATS',filters}); const rows=r?.items||[]; orgChatRows=rows;
    $('orgChatList').innerHTML=rows.length?rows.map(orgChatCard).join(''):'<div class="empty">No chats match this workspace view.</div>'; renderBulkBar();
  }

  async function loadProjects(refresh=false){
    if(refresh||!organization.projects?.length){const r=await call({type:'PC_ORG_SUMMARY'});if(r?.ok)organization=r.organization||organization;}
    renderOrganizationChrome(); await loadOrganizerChats();
  }

  function fillParentOptions(mode,currentId=''){
    const groups=(organization.groups||[]).filter((g)=>g.id!==currentId); const projects=(organization.projects||[]).filter((p)=>!p.archived);
    if(mode==='move-chat') $('orgParent').innerHTML=['<option value="">Unassigned</option>',...projects.map((p)=>`<option value="${esc(p.id)}">${esc(groupLabel(p.groupId))} / ${esc(p.name)}</option>`)].join('');
    else $('orgParent').innerHTML=['<option value="">No group</option>',...groups.map((g)=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`)].join('');
  }

  function fieldVisible(id,visible){$(id).classList.toggle('org-field-hidden',!visible);}
  function openOrgDialog(mode,id=''){
    const dialog=$('orgDialog'); const project=mode.includes('project')?orgProject(id):null;const group=mode.includes('group')?orgGroup(id):null;const smart=mode.includes('smart')?(organization.smartCollections||[]).find((c)=>c.id===id):null;const chat=orgChatRows.find((c)=>c.id===id)||(home?.recentChats||[]).find((c)=>c.id===id)||null;const rec=project||group||smart;
    $('orgDialogMode').value=mode;$('orgDialogId').value=id;$('orgDialogTitle').textContent=mode==='new-group'?'Create group':mode==='new-project'?'Create project':mode==='new-smart'?'Create smart collection':mode==='tag-chat'?'Edit chat tags':mode==='move-chat'?'Move chat':`Edit ${mode.replace('edit-','')}`;
    $('orgName').value=rec?.name||'';$('orgIcon').value=rec?.icon||(mode.includes('group')?'◇':mode.includes('smart')?'⌕':'✦');$('orgColor').value=rec?.color||'#7d92ff';$('orgDescription').value=rec?.description||rec?.notes||'';$('orgQuery').value=smart?.query||'';$('orgTags').value=(chat?.tags||[]).join(', ');
    fillParentOptions(mode,id);$('orgParent').value=mode==='move-chat'?(chat?.workspaceProjectId||''):(rec?.groupId||rec?.parentId||'');
    const tagMode=mode==='tag-chat',moveMode=mode==='move-chat',smartMode=mode.includes('smart');fieldVisible('orgNameField',!tagMode&&!moveMode);fieldVisible('orgIconField',!tagMode&&!moveMode);fieldVisible('orgColorField',mode.includes('project')||mode.includes('group'));fieldVisible('orgParentField',!tagMode);fieldVisible('orgQueryField',smartMode);fieldVisible('orgTagsField',tagMode);fieldVisible('orgDescriptionField',!tagMode&&!moveMode);
    $('orgDialogDelete').classList.toggle('hidden',mode.startsWith('new-')||mode==='tag-chat'||mode==='move-chat'); dialog.showModal(); setTimeout(()=>{const target=tagMode?$('orgTags'):moveMode?$('orgParent'):$('orgName');target.focus();},0);
  }

  async function saveOrgDialog(event){
    event.preventDefault(); const mode=$('orgDialogMode').value,id=$('orgDialogId').value;let response;
    if(mode==='tag-chat') response=await call({type:'PC_ORG_CHAT_PATCH',chatIds:[id],patch:{tags:$('orgTags').value}});
    else if(mode==='move-chat') response=await call({type:'PC_ORG_CHAT_PATCH',chatIds:[id],patch:{workspaceProjectId:$('orgParent').value}});
    else {
      const input={name:$('orgName').value.trim(),icon:$('orgIcon').value.trim(),color:$('orgColor').value,description:$('orgDescription').value.trim()};
      if(mode.includes('group'))input.parentId=$('orgParent').value;else input.groupId=$('orgParent').value;if(mode.includes('smart'))input.query=$('orgQuery').value.trim();
      if(mode==='new-group')response=await call({type:'PC_ORG_GROUP_CREATE',input});else if(mode==='new-project')response=await call({type:'PC_ORG_PROJECT_CREATE',input});else if(mode==='new-smart')response=await call({type:'PC_ORG_SMART_CREATE',input});else response=await call({type:'PC_ORG_ENTITY_UPDATE',kind:mode.replace('edit-',''),id,patch:input});
    }
    if(!response?.ok){toast(response?.error||'Organization change failed');return;}$('orgDialog').close();selectedOrgChats.clear();await loadProjects(true);toast('Workspace updated');
  }

  async function loadChats(reset=false){
    if(reset){chatOffset=0;$('chatBrowser').innerHTML='';}
    const r=await call({type:'PC_BRAIN_LIST',entityType:'chat',limit:80,offset:chatOffset}); const rows=r?.items||[]; chatOffset+=rows.length;
    $('chatBrowser').insertAdjacentHTML('beforeend',rows.map((chat)=>workCard(chat)).join('') || (chatOffset===0?'<div class="empty">No chats yet.</div>':''));
    $('moreChats').classList.toggle('hidden',rows.length<80);
  }

  async function loadFiles(reset=false){
    if(reset){fileOffset=0;$('fileBrowser').innerHTML='';}
    const r=await call({type:'PC_BRAIN_LIST',entityType:'file',limit:80,offset:fileOffset}); const rows=r?.items||[]; fileOffset+=rows.length;
    $('fileBrowser').insertAdjacentHTML('beforeend',rows.map(fileCard).join('') || (fileOffset===0?'<div class="empty">No files yet.</div>':''));
    $('moreFiles').classList.toggle('hidden',rows.length<80);
  }

  function findEocd(view){
    for(let i=view.byteLength-22;i>=Math.max(0,view.byteLength-65557);i--) if(view.getUint32(i,true)===0x06054b50)return i;
    return -1;
  }

  async function unzipConversationJson(file){
    const buffer=await file.arrayBuffer(); const view=new DataView(buffer); const eocd=findEocd(view); if(eocd<0)throw new Error('ZIP central directory not found.');
    const entries=view.getUint16(eocd+10,true); let pos=view.getUint32(eocd+16,true); const decoder=new TextDecoder(); const arrays=[];
    for(let i=0;i<entries;i++){
      if(view.getUint32(pos,true)!==0x02014b50)break;
      const method=view.getUint16(pos+10,true), compressed=view.getUint32(pos+20,true), nameLen=view.getUint16(pos+28,true), extraLen=view.getUint16(pos+30,true), commentLen=view.getUint16(pos+32,true), local=view.getUint32(pos+42,true);
      const name=decoder.decode(new Uint8Array(buffer,pos+46,nameLen)); pos+=46+nameLen+extraLen+commentLen;
      if(!/(^|\/)conversations(?:-\d+|_\d+)?\.json$/i.test(name))continue;
      if(view.getUint32(local,true)!==0x04034b50)continue;
      const localName=view.getUint16(local+26,true), localExtra=view.getUint16(local+28,true), start=local+30+localName+localExtra;
      const raw=new Uint8Array(buffer,start,compressed); let text='';
      if(method===0) text=decoder.decode(raw);
      else if(method===8){ if(typeof DecompressionStream!=='function')throw new Error('This browser cannot decompress deflated ZIP entries.'); const stream=new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')); text=await new Response(stream).text(); }
      else throw new Error(`Unsupported ZIP compression method ${method}.`);
      const parsed=JSON.parse(text); if(Array.isArray(parsed))arrays.push(...parsed); else if(Array.isArray(parsed?.conversations))arrays.push(...parsed.conversations);
    }
    if(!arrays.length)throw new Error('No conversations.json entries were found in the export.');
    return arrays;
  }

  async function conversationsFromFile(file){
    if(/\.zip$/i.test(file.name)||file.type.includes('zip'))return unzipConversationJson(file);
    const parsed=JSON.parse(await file.text());
    if(Array.isArray(parsed))return parsed; if(Array.isArray(parsed?.conversations))return parsed.conversations;
    throw new Error('The JSON file does not contain a conversation array.');
  }

  function extractUrls(text){ return [...new Set(String(text||'').match(/https?:\/\/[^\s<>"')\]]+/g)||[])].slice(0,60); }
  function messageText(message){
    const parts=message?.content?.parts || message?.content?.content || [];
    if(typeof parts==='string')return parts;
    if(Array.isArray(parts))return parts.map((p)=>typeof p==='string'?p:(p?.text||p?.content||'')).filter(Boolean).join('\n');
    return message?.content?.text || '';
  }

  async function importChatGPTExport(file){
    $('importProgress').textContent=`Reading ${file.name}…`;
    const conversations=await conversationsFromFile(file);
    let chats=0,turns=0,files=0; const payload=[]; const flush=async()=>{if(!payload.length)return;const batch=payload.splice(0,payload.length);const r=await call({type:'PC_BRAIN_INGEST_BATCH',payload:batch});if(!r?.ok)throw new Error(r?.error||'Import batch failed');};
    for(let ci=0;ci<conversations.length;ci++){
      const conv=conversations[ci]||{}; const rawId=conv.id||conv.conversation_id||conv.conversationId||`export-${ci}`; const chatId=`chatgpt:${rawId}`; const url=`https://chatgpt.com/c/${encodeURIComponent(rawId)}`; const title=String(conv.title||'Untitled imported chat').slice(0,300); const updatedAt=Math.round(Number(conv.update_time||conv.create_time||Date.now()/1000)*1000)||Date.now();
      payload.push({type:'CHAT_UPSERT',data:{id:chatId,providerId:'chatgpt',providerName:'ChatGPT',title,url,projectId:'chatgpt:imported',projectName:'Imported ChatGPT',source:'chatgpt-data-export',coverage:'full-export',status:'archived',lastSeenAt:updatedAt,updatedAt}}); chats++;
      const nodes=Object.values(conv.mapping||{}).filter((n)=>n?.message).sort((a,b)=>Number(a.message?.create_time||0)-Number(b.message?.create_time||0));
      for(let i=0;i<nodes.length;i++){
        const msg=nodes[i].message||{}; const text=messageText(msg); if(!text)continue; const role=msg.author?.role||'unknown'; const messageId=msg.id||nodes[i].id||`${role}-${i}`; const at=Math.round(Number(msg.create_time||conv.update_time||conv.create_time||Date.now()/1000)*1000)||updatedAt;
        payload.push({type:'TURN_UPSERT',data:{id:`${chatId}:${messageId}`,providerId:'chatgpt',chatId,messageId,role,ordinal:i,text:String(text).slice(0,50000),source:'chatgpt-data-export',url,updatedAt:at}}); turns++;
        for(const href of extractUrls(text)){
          if(!/\.(zip|jar|7z|rar|pdf|docx?|xlsx?|pptx?|csv|json|md|txt|png|jpe?g|gif|webp|svg|mp4|webm|blend|obj|fbx|stl)(?:[?#]|$)/i.test(href) && !/(drive\.google\.com|github\.com|dropbox\.com|1drv\.ms|onedrive\.live\.com)/i.test(href))continue;
          let name='linked artifact';try{name=decodeURIComponent(new URL(href).pathname.split('/').filter(Boolean).pop()||name);}catch(_){}
          payload.push({type:'FILE_UPSERT',data:{id:`${chatId}:export:${stableHash(href)}`,providerId:'chatgpt',chatId,name,href,externalUrl:href,externalProvider:new URL(href).hostname,kind:'linked-file',source:'chatgpt-data-export',sourcePage:url,updatedAt:at}});files++;
        }
        if(payload.length>=240)await flush();
      }
      if(payload.length>=240)await flush();
      if(ci%25===0)$('importProgress').textContent=`Importing ${fmt(ci+1)} / ${fmt(conversations.length)} chats · ${fmt(turns)} turns…`;
    }
    await flush(); await call({type:'PC_SEARCH_REBUILD'}); await loadHome();
    $('importProgress').textContent=`Imported ${fmt(chats)} chats, ${fmt(turns)} turns, and ${fmt(files)} linked artifacts. Full-text index rebuilt.`;
  }

  async function requestDriveOrigin(){ return chrome.permissions.request({origins:['https://www.googleapis.com/*']}); }

  // Workbench navigation is delegated from all activity/sidebar/status surfaces.
  document.body.addEventListener('click',async(event)=>{
    const closeTab=event.target.closest?.('[data-close-tab]')?.dataset.closeTab;if(closeTab){event.stopPropagation();closeWorkbenchTab(closeTab);return;}
    const sidebarProject=event.target.closest?.('[data-sidebar-project]')?.dataset.sidebarProject;if(sidebarProject){orgScope={workspaceProjectId:sidebarProject,groupId:'',tag:'',mode:'all',sort:orgScope.sort};switchView('projects');return;}
    const sidebarSmart=event.target.closest?.('[data-sidebar-smart]')?.dataset.sidebarSmart;if(sidebarSmart){const smart=(organization.smartCollections||[]).find((c)=>c.id===sidebarSmart);if(smart?.query)runSearch(smart.query);return;}
    const tabView=event.target.closest?.('[data-tab-view]')?.dataset.tabView;if(tabView){switchView(tabView);return;}
    const navView=event.target.closest?.('[data-view]')?.dataset.view;if(navView){switchView(navView);return;}
    const inspectChat=event.target.closest?.('[data-inspect-chat]')?.dataset.inspectChat;if(inspectChat&&!event.target.closest('[data-open-url],[data-search-query],[data-chat-id],[data-org-chat-action]')){inspectEntity('chat',inspectChat);}
    const inspectFile=event.target.closest?.('[data-inspect-file]')?.dataset.inspectFile;if(inspectFile&&!event.target.closest('[data-open-url],[data-chat-id]')){inspectEntity('file',inspectFile);}
    const inspectProject=event.target.closest?.('[data-inspect-project]')?.dataset.inspectProject;if(inspectProject&&!event.target.closest('.mini-actions'))inspectEntity('project',inspectProject);
    const mode=event.target.closest?.('[data-org-mode]')?.dataset.orgMode;if(mode){orgScope={workspaceProjectId:'',groupId:'',tag:'',mode,sort:orgScope.sort};renderOrganizationChrome();await loadOrganizerChats();return;}
    const groupId=event.target.closest?.('[data-org-group]')?.dataset.orgGroup;if(groupId&&!event.target.closest('[data-org-edit-group]')){orgScope={workspaceProjectId:'',groupId,tag:'',mode:'all',sort:orgScope.sort};renderOrganizationChrome();await loadOrganizerChats();return;}
    const projectId=event.target.closest?.('[data-org-project]')?.dataset.orgProject;if(projectId&&!event.target.closest('.mini-actions')){orgScope={workspaceProjectId:projectId,groupId:'',tag:'',mode:'all',sort:orgScope.sort};if(!$('projects').classList.contains('active')){switchView('projects');}else{renderOrganizationChrome();await loadOrganizerChats();}return;}
    const tag=event.target.closest?.('[data-org-tag]')?.dataset.orgTag;if(tag){orgScope={workspaceProjectId:'',groupId:'',tag,mode:'all',sort:orgScope.sort};renderOrganizationChrome();await loadOrganizerChats();return;}
    const smartId=event.target.closest?.('[data-org-smart]')?.dataset.orgSmart;if(smartId&&!event.target.closest('[data-org-edit-smart]')){const smart=(organization.smartCollections||[]).find((c)=>c.id===smartId);if(smart?.query)runSearch(smart.query);return;}
    const editGroup=event.target.closest?.('[data-org-edit-group]')?.dataset.orgEditGroup;if(editGroup){openOrgDialog('edit-group',editGroup);return;}
    const editProject=event.target.closest?.('[data-org-edit-project]')?.dataset.orgEditProject;if(editProject){openOrgDialog('edit-project',editProject);return;}
    const editSmart=event.target.closest?.('[data-org-edit-smart]')?.dataset.orgEditSmart;if(editSmart){openOrgDialog('edit-smart',editSmart);return;}
    const pinProject=event.target.closest?.('[data-org-project-pin]')?.dataset.orgProjectPin;if(pinProject){const p=orgProject(pinProject);await call({type:'PC_ORG_ENTITY_UPDATE',kind:'project',id:pinProject,patch:{pinned:!p?.pinned}});await loadProjects(true);return;}
    const chatAction=event.target.closest?.('[data-org-chat-action]')?.dataset.orgChatAction;const actionChat=event.target.closest?.('[data-org-chat-action]')?.dataset.chatId;if(chatAction&&actionChat){const rows=[...document.querySelectorAll('[data-drag-chat]')];const row=rows.find((n)=>n.dataset.dragChat===actionChat);const pin=row?.querySelector('[data-org-chat-action="pin"]')?.classList.contains('on');const fav=row?.querySelector('[data-org-chat-action="favorite"]')?.classList.contains('on');const archived=row?.querySelector('[data-org-chat-action="archive"]')?.classList.contains('on');if(chatAction==='tag'){openOrgDialog('tag-chat',actionChat);return;}if(chatAction==='move'){openOrgDialog('move-chat',actionChat);return;}const patch=chatAction==='pin'?{pinned:!pin}:chatAction==='favorite'?{favorite:!fav}:{organizedArchived:!archived};await call({type:'PC_ORG_CHAT_PATCH',chatIds:[actionChat],patch});await loadProjects(true);return;}
    const jump=event.target.closest?.('[data-jump]')?.dataset.jump;if(jump){switchView(jump);return;}
    const url=event.target.closest?.('[data-open-url]')?.dataset.openUrl;if(url){openUrl(url);return;}
    const q=event.target.closest?.('[data-search-query]')?.dataset.searchQuery;if(q){runSearch(q);return;}
    const chatId=event.target.closest?.('[data-chat-id]')?.dataset.chatId;if(chatId){call({type:'PC_HOME_SEARCH',query:chatId,limit:10}).then((r)=>{const url=r?.result?.groups?.find((g)=>g.chat?.id===chatId)?.chat?.url;if(url)openUrl(url);});}
  });
  $('globalSearch').addEventListener('input',()=>{if(searchTimer)clearTimeout(searchTimer);const q=$('globalSearch').value.trim();if(!q)return;searchTimer=setTimeout(()=>runSearch(q),180);});
  $('globalSearch').addEventListener('keydown',(e)=>{if(e.key==='Enter'&&$('globalSearch').value.trim())runSearch($('globalSearch').value);});
  window.addEventListener('keydown',(e)=>{
    const mod=e.ctrlKey||e.metaKey;
    if(mod&&e.key.toLowerCase()==='k'){e.preventDefault();$('globalSearch').focus();$('globalSearch').select();return;}
    if(mod&&e.shiftKey&&e.key.toLowerCase()==='p'){e.preventDefault();openCommandPalette();return;}
    if(mod&&!e.shiftKey&&!e.altKey&&e.key.toLowerCase()==='b'){e.preventDefault();workbenchState.primary=!workbenchState.primary;workbenchState.focus=false;applyWorkbenchState({persist:true});return;}
    if(mod&&e.altKey&&e.key.toLowerCase()==='b'){e.preventDefault();workbenchState.inspector=!workbenchState.inspector;workbenchState.focus=false;applyWorkbenchState({persist:true});return;}
    if(mod&&!e.shiftKey&&e.key.toLowerCase()==='j'){e.preventDefault();workbenchState.panel=!workbenchState.panel;workbenchState.focus=false;applyWorkbenchState({persist:true});return;}
    if(e.key==='Escape'){closeCommandPalette();toggleLayoutPopover(false);}
  });
  $('togglePrimarySidebar').addEventListener('click',()=>{workbenchState.primary=!workbenchState.primary;workbenchState.focus=false;applyWorkbenchState({persist:true});});
  $('toggleInspector').addEventListener('click',()=>{workbenchState.inspector=!workbenchState.inspector;workbenchState.focus=false;applyWorkbenchState({persist:true});});
  $('closeInspector').addEventListener('click',()=>{workbenchState.inspector=false;applyWorkbenchState({persist:true});});
  $('toggleBottomPanel').addEventListener('click',()=>{workbenchState.panel=!workbenchState.panel;workbenchState.focus=false;applyWorkbenchState({persist:true});});
  $('closeBottomPanel').addEventListener('click',()=>{workbenchState.panel=false;applyWorkbenchState({persist:true});});
  $('maximizeBottomPanel').addEventListener('click',()=>{workbenchState.panel=true;workbenchState.panelMax=!workbenchState.panelMax;applyWorkbenchState({persist:true});});
  $('layoutButton').addEventListener('click',()=>toggleLayoutPopover());$('activityLayoutButton').addEventListener('click',()=>toggleLayoutPopover());$('statusLayout').addEventListener('click',()=>toggleLayoutPopover());$('sidebarMore').addEventListener('click',()=>toggleLayoutPopover());$('viewMenuButton').addEventListener('click',()=>toggleLayoutPopover());
  $('workspaceMenuButton').addEventListener('click',()=>openCommandPalette());
  $('closeLayoutPopover').addEventListener('click',()=>toggleLayoutPopover(false));
  $('commandPaletteButton').addEventListener('click',()=>openCommandPalette());$('editorMore').addEventListener('click',()=>openCommandPalette());
  document.querySelectorAll('[data-layout-toggle]').forEach((button)=>button.addEventListener('click',()=>{const key=button.dataset.layoutToggle;if(key==='focus')workbenchState.focus=!workbenchState.focus;else{workbenchState[key]=!workbenchState[key];workbenchState.focus=false;}applyWorkbenchState({persist:true});}));
  document.querySelectorAll('[data-layout-preset]').forEach((button)=>button.addEventListener('click',()=>applyLayoutPreset(button.dataset.layoutPreset)));
  document.querySelectorAll('button[data-density]').forEach((button)=>button.addEventListener('click',()=>{workbenchState.density=button.dataset.density;applyWorkbenchState({persist:true});}));
  document.querySelectorAll('[data-theme-choice]').forEach((button)=>button.addEventListener('click',()=>{workbenchState.theme=button.dataset.themeChoice;applyWorkbenchState({persist:true});}));
  document.querySelectorAll('[data-primary-side]').forEach((button)=>button.addEventListener('click',()=>{workbenchState.primarySide=button.dataset.primarySide;applyWorkbenchState({persist:true});}));
  document.querySelectorAll('[data-panel-position]').forEach((button)=>button.addEventListener('click',()=>{workbenchState.panelPosition=button.dataset.panelPosition;applyWorkbenchState({persist:true});}));
  $('saveCurrentLayout').addEventListener('click',async()=>{const name=prompt('Name this workspace layout:','My workspace');if(!name?.trim())return;savedLayouts[name.trim()]=layoutSnapshot();if(chrome.storage?.local?.set)await chrome.storage.local.set({pcWorkbenchSavedLayouts:savedLayouts});renderLayoutControls();toast(`Saved layout: ${name.trim()}`);});
  $('applySavedLayout').addEventListener('click',()=>{const saved=savedLayouts[$('savedLayoutSelect').value];if(!saved)return;workbenchState={...workbenchState,...saved,openTabs:[...(saved.openTabs||workbenchState.openTabs)]};applyWorkbenchState({persist:true});switchView(workbenchState.activeView||'overview');});
  $('resetLayout').addEventListener('click',()=>{workbenchState={...DEFAULT_WORKBENCH,openTabs:[...DEFAULT_WORKBENCH.openTabs]};applyWorkbenchState({persist:true});switchView('overview');});
  document.querySelectorAll('[data-panel-tab]').forEach((button)=>button.addEventListener('click',()=>{workbenchState.panelTab=button.dataset.panelTab;workbenchState.panel=true;renderBottomPanel();applyWorkbenchState({persist:true});}));
  document.querySelectorAll('[data-inspector-tab]').forEach((button)=>button.addEventListener('click',()=>{workbenchState.inspectorTab=button.dataset.inspectorTab;renderInspector();persistWorkbench();}));
  document.querySelectorAll('[data-sidebar-section]').forEach((button)=>button.addEventListener('click',()=>button.closest('.sidebar-section')?.classList.toggle('open')));
  $('commandInput').addEventListener('input',()=>{commandIndex=0;renderCommandPalette();});
  $('commandInput').addEventListener('keydown',(event)=>{if(event.key==='ArrowDown'){event.preventDefault();commandIndex=Math.min(commandRows.length-1,commandIndex+1);renderCommandPalette();}else if(event.key==='ArrowUp'){event.preventDefault();commandIndex=Math.max(0,commandIndex-1);renderCommandPalette();}else if(event.key==='Enter'){event.preventDefault();const row=commandRows[commandIndex];if(row){closeCommandPalette();row.action();}}else if(event.key==='Escape'){closeCommandPalette();}});
  $('commandResults').addEventListener('click',(event)=>{const index=Number(event.target.closest?.('[data-command-index]')?.dataset.commandIndex);if(!Number.isFinite(index)||!commandRows[index])return;const row=commandRows[index];closeCommandPalette();row.action();});
  $('commandPalette').addEventListener('click',(event)=>{if(event.target===$('commandPalette'))closeCommandPalette();});
  function bindResizer(id,key,axis,min,max){const node=$(id);node.addEventListener('pointerdown',(event)=>{event.preventDefault();node.setPointerCapture?.(event.pointerId);node.classList.add('dragging');const start=axis==='x'?event.clientX:event.clientY;const initial=Number(workbenchState[key]);const move=(e)=>{const delta=(axis==='x'?e.clientX:e.clientY)-start;const dir=id==='bottomPanelResizer'?(workbenchState.panelPosition==='top'?1:-1):id==='inspectorResizer'?(workbenchState.primarySide==='right'?1:-1):(workbenchState.primarySide==='right'?-1:1);workbenchState[key]=Math.max(min,Math.min(max,initial+delta*dir));applyWorkbenchState();};const up=()=>{node.classList.remove('dragging');window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);persistWorkbench(true);};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);});}
  bindResizer('primaryResizer','primaryWidth','x',190,520);bindResizer('inspectorResizer','inspectorWidth','x',230,560);bindResizer('bottomPanelResizer','panelHeight','y',120,620);
  $('refreshHome').addEventListener('click',()=>loadHome().catch((e)=>{$('railSub').textContent=e.message;}));
  $('openPanel').addEventListener('click',async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(tab?.windowId)await chrome.sidePanel.open({windowId:tab.windowId});});
  $('moreChats').addEventListener('click',()=>loadChats(false)); $('moreFiles').addEventListener('click',()=>loadFiles(false));
  $('enableHistory').addEventListener('click',async()=>{const granted=await chrome.permissions.request({permissions:['history']}).catch(()=>false);$('enableHistory').textContent=granted?'Browser history discovery enabled':'History permission not granted';await loadHome();});
  $('runCatalog').addEventListener('click',async()=>{let granted=await chrome.permissions.contains({permissions:['history']}).catch(()=>false);if(!granted)granted=await chrome.permissions.request({permissions:['history']}).catch(()=>false);$('catalogHomeStatus').textContent=granted?'Starting zero-tab catalog with browser-history discovery…':'Starting without browser-history discovery…';const r=await call({type:'PC_CATALOG_START',providerIds:providers.map((p)=>p.id)});if(!r?.ok)$('catalogHomeStatus').textContent=r?.error||'Catalog start failed';else setTimeout(()=>loadHome(),500);});
  $('stopCatalogHome').addEventListener('click',async()=>{await call({type:'PC_CATALOG_STOP'});await loadHome();});
  $('startFullCapture').addEventListener('click',async()=>{
    $('fullCaptureStatus').textContent='Preparing one dedicated minimized capture window…';
    let granted=await chrome.permissions.contains({permissions:['history']}).catch(()=>false);
    if(!granted)granted=await chrome.permissions.request({permissions:['history']}).catch(()=>false);
    const r=await call({type:'PC_FULL_CAPTURE_START',providerIds:providers.map((p)=>p.id),speed:$('fullCaptureSpeed').value});
    if(!r?.ok)$('fullCaptureStatus').textContent=r?.error||'Full capture could not start.';
    await loadHome();
  });
  $('pauseFullCapture').addEventListener('click',async()=>{await call({type:'PC_FULL_CAPTURE_PAUSE'});await loadHome();});
  $('resumeFullCapture').addEventListener('click',async()=>{await call({type:'PC_FULL_CAPTURE_RESUME'});await loadHome();});
  $('stopFullCapture').addEventListener('click',async()=>{await call({type:'PC_FULL_CAPTURE_STOP'});await loadHome();});
  $('historyImport').addEventListener('change',async()=>{const file=$('historyImport').files?.[0];if(!file)return;try{await importChatGPTExport(file);}catch(error){$('importProgress').textContent=`Import failed: ${error.message}`;}finally{$('historyImport').value='';}});
  $('homeDriveSync').addEventListener('click',async()=>{try{if(!await requestDriveOrigin())throw new Error('Google Drive permission not granted.');$('durabilityStatus').textContent='Creating and verifying remote checkpoint…';const r=await call({type:'PC_DRIVE_SYNC',interactive:true,forceRoundtrip:true});if(!r?.ok)throw new Error(r?.error||'Drive sync failed');$('durabilityStatus').textContent=`Drive verified · ${fmt(r.size)} bytes · SHA-256 ${r.sha256.slice(0,16)}…`;await loadHome();}catch(e){$('durabilityStatus').textContent=e.message;}});
  $('homeDriveRestore').addEventListener('click',async()=>{try{if(!await requestDriveOrigin())throw new Error('Google Drive permission not granted.');$('durabilityStatus').textContent='Downloading, verifying, merging, and rebuilding index…';const r=await call({type:'PC_DRIVE_RESTORE',interactive:true});if(!r?.ok)throw new Error(r?.error||'Restore failed');$('durabilityStatus').textContent=`Drive recovery merged successfully · ${fmt(r.size)} bytes verified.`;await loadHome();}catch(e){$('durabilityStatus').textContent=e.message;}});

  document.querySelectorAll('[data-dialog-close]').forEach((button)=>button.addEventListener('click',()=>$('orgDialog').close()));
  $('orgDialogDelete').addEventListener('click',async()=>{const mode=$('orgDialogMode').value,id=$('orgDialogId').value,kind=mode.replace('edit-','');if(!['group','project','smart'].includes(kind)||!id)return;if(!confirm(`Remove this ${kind} from Constellation organization? Chats and files are preserved.`))return;const r=await call({type:'PC_ORG_ENTITY_DELETE',kind,id});if(!r?.ok){toast(r?.error||'Remove failed');return;}$('orgDialog').close();orgScope={workspaceProjectId:'',groupId:'',tag:'',mode:'all',sort:orgScope.sort};await loadProjects(true);toast('Organizer item removed');});
  $('newGroup').addEventListener('click',()=>openOrgDialog('new-group'));
  $('newProject').addEventListener('click',()=>openOrgDialog('new-project'));
  $('newSmart').addEventListener('click',()=>openOrgDialog('new-smart'));
  $('orgDialogForm').addEventListener('submit',saveOrgDialog);
  $('orgFilter').addEventListener('change',()=>{orgScope={...orgScope,mode:$('orgFilter').value,workspaceProjectId:orgScope.workspaceProjectId,groupId:orgScope.groupId,tag:orgScope.tag};renderOrganizationChrome();loadOrganizerChats();});
  $('orgSort').addEventListener('change',()=>{orgScope.sort=$('orgSort').value;loadOrganizerChats();});
  $('orgChatList').addEventListener('change',(event)=>{const id=event.target?.dataset?.orgSelectChat;if(!id)return;if(event.target.checked)selectedOrgChats.add(id);else selectedOrgChats.delete(id);renderBulkBar();});
  $('orgBulkClear').addEventListener('click',()=>{selectedOrgChats.clear();document.querySelectorAll('[data-org-select-chat]').forEach((n)=>n.checked=false);renderBulkBar();});
  $('orgBulkMove').addEventListener('click',async()=>{if(!selectedOrgChats.size)return;await call({type:'PC_ORG_CHAT_PATCH',chatIds:[...selectedOrgChats],patch:{workspaceProjectId:$('orgBulkProject').value}});selectedOrgChats.clear();await loadProjects(true);toast('Chats moved');});
  $('orgBulkPin').addEventListener('click',async()=>{if(!selectedOrgChats.size)return;await call({type:'PC_ORG_CHAT_PATCH',chatIds:[...selectedOrgChats],patch:{pinned:true}});selectedOrgChats.clear();await loadProjects(true);toast('Chats pinned');});
  $('orgBulkArchive').addEventListener('click',async()=>{if(!selectedOrgChats.size)return;await call({type:'PC_ORG_CHAT_PATCH',chatIds:[...selectedOrgChats],patch:{organizedArchived:true}});selectedOrgChats.clear();await loadProjects(true);toast('Chats archived');});
  document.addEventListener('dragstart',(event)=>{const chat=event.target.closest?.('[data-drag-chat]');const project=event.target.closest?.('[data-org-project]');if(chat){event.dataTransfer.setData('application/x-project-constellation-chat',chat.dataset.dragChat);event.dataTransfer.effectAllowed='move';}else if(project){event.dataTransfer.setData('application/x-project-constellation-project',project.dataset.orgProject);event.dataTransfer.effectAllowed='move';}});
  document.addEventListener('dragover',(event)=>{const target=event.target.closest?.('[data-project-drop],[data-group-drop]');if(target){event.preventDefault();event.dataTransfer.dropEffect='move';target.classList.add('dragover');}});
  document.addEventListener('dragleave',(event)=>event.target.closest?.('[data-project-drop],[data-group-drop]')?.classList.remove('dragover'));
  document.addEventListener('drop',async(event)=>{const target=event.target.closest?.('[data-project-drop],[data-group-drop]');if(!target)return;event.preventDefault();target.classList.remove('dragover');const chatId=event.dataTransfer.getData('application/x-project-constellation-chat');const draggedProject=event.dataTransfer.getData('application/x-project-constellation-project');if(chatId&&target.dataset.projectDrop){await call({type:'PC_ORG_CHAT_PATCH',chatIds:[chatId],patch:{workspaceProjectId:target.dataset.projectDrop}});await loadProjects(true);toast('Chat moved');return;}if(draggedProject&&target.dataset.groupDrop){await call({type:'PC_ORG_ENTITY_UPDATE',kind:'project',id:draggedProject,patch:{groupId:target.dataset.groupDrop}});await loadProjects(true);toast('Project moved');}});

  loadWorkbenchState().then(()=>{switchView(workbenchState.activeView||'overview');return loadHome();}).catch((error)=>{$('railSub').textContent=error.message;});
})();
