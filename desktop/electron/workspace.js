'use strict';
(()=>{
  const api=window.commanderShell,$=id=>document.getElementById(id);
  let opened=null,dirty=false,session='',timer=null,refreshing=false,wide=false;
  $('workspace-toggle').onclick=()=>window.commanderNavigate?.('workspace');
  const outputs=new Map();
  function status(id,message,bad=false){$(id).textContent=message;$(id).classList.toggle('error-text',bad);}
  async function tool(name,args){const response=await api.runTool(name,args);if(response?.ok===false)throw new Error(response.error||'Tool failed');return response.result??response;}
  function guardDirty(){return !dirty||window.confirm('Discard unsaved editor changes?');}
  async function openFile(p){
    if(!guardDirty())return;
    try{const result=await tool('read_file',{path:p,length:0});opened={path:result.path,hash:result.sha256,lineEnding:result.line_ending};dirty=false;$('editor-filename').textContent=result.path.split(/[\\/]/).pop();$('editor-dirty').classList.add('hidden');$('workspace-path').value=result.path;$('workspace-editor').value=result.content;$('workspace-save').disabled=false;status('workspace-status',`Opened ${result.path}`);}
    catch(e){status('workspace-status',e.message,true);}
  }
  async function browse(p){
    try{const info=await tool('get_file_info',{path:p});if(info.isFile)p=info.parent;const result=await tool('list_directory',{path:p,depth:1});$('workspace-path').value=result.root;$('terminal-cwd').value=result.root;const list=$('workspace-list');list.replaceChildren();
      for(const entry of result.entries){const button=document.createElement('button');button.className='ghost';button.textContent=`${entry.type==='directory'?'Folder: ':'File: '}${entry.name}`;button.onclick=()=>entry.type==='directory'?browse(entry.path):openFile(entry.path);list.append(button);}
      $('file-filter').dispatchEvent(new Event('input'));status('workspace-status',`${result.entries.length} entries${dirty?' / editor has unsaved changes':''}`);
    }catch(e){status('workspace-status',e.message,true);}
  }
  $('workspace-editor').addEventListener('input',()=>{dirty=true;$('editor-dirty').classList.remove('hidden');status('workspace-status','Unsaved changes');});
  $('workspace-open').onclick=()=>openFile($('workspace-path').value);
  $('workspace-browse').onclick=()=>browse($('workspace-path').value);
  $('workspace-up').onclick=async()=>{try{const info=await tool('get_file_info',{path:$('workspace-path').value});await browse(info.parent);}catch(e){status('workspace-status',e.message,true);}};
  $('workspace-reveal').onclick=async()=>{try{await tool('open_path',{path:$('workspace-path').value});}catch(e){status('workspace-status',e.message,true);}};
  $('workspace-save').onclick=async()=>{
    if(!opened)return;$('workspace-save').disabled=true;
    try{const result=await tool('write_file',{path:opened.path,content:opened.lineEnding==='crlf'?$('workspace-editor').value.replace(/\r?\n/g,'\r\n'):$('workspace-editor').value,expected_sha256:opened.hash});opened.hash=result.sha256;dirty=false;$('editor-dirty').classList.add('hidden');status('workspace-status','Saved and verified.');}
    catch(e){status('workspace-status',e.message,true);}finally{$('workspace-save').disabled=false;}
  };
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
  async function loadSessions(){
    const result=await tool('list_sessions',{});const select=$('terminal-session');select.replaceChildren();
    const empty=document.createElement('option');empty.value='';empty.textContent='Select a session';select.add(empty);
    for(const item of result.sessions){const option=document.createElement('option');option.value=item.session_id;option.textContent=`${item.status}: ${item.command}`;select.add(option);}
    select.value=session;return result.sessions;
  }
  async function refreshOutput(){
    if(!session||refreshing)return;refreshing=true;const target=session;
    try{const result=await tool('read_process_output',{session_id:target});outputs.set(target,(outputs.get(target)||'')+(result.output||''));
      if(target===session){$('terminal-output').textContent=outputs.get(target);$('terminal-output').scrollTop=$('terminal-output').scrollHeight;status('terminal-status',`${result.status}${result.exit_code!=null?' (exit '+result.exit_code+')':''}${result.error?' - '+result.error:''}`,['failed','timed_out','interrupted'].includes(result.status));$('terminal-stop').disabled=!['starting','running','stopping'].includes(result.status);}
      clearTimeout(timer);if(['starting','running','stopping'].includes(result.status)&&target===session)timer=setTimeout(refreshOutput,400);
      else await loadSessions();
    }catch(e){status('terminal-status',e.message,true);}finally{refreshing=false;}
  }
  $('terminal-run').onclick=async()=>{
    $('terminal-run').disabled=true;
    try{const result=await tool('start_process',{command:$('terminal-command').value,cwd:$('terminal-cwd').value});session=result.session_id;outputs.set(session,'');await loadSessions();await refreshOutput();}
    catch(e){status('terminal-status',e.message,true);}finally{$('terminal-run').disabled=false;}
  };
  $('terminal-send').onclick=async()=>{
    if(!session)return status('terminal-status','Choose a running session first.',true);
    try{const result=await tool('interact_with_process',{session_id:session,input:$('terminal-stdin').value+'\n',wait_ms:50});
      outputs.set(session,(outputs.get(session)||'')+(result.output||''));$('terminal-output').textContent=outputs.get(session);$('terminal-stdin').value='';await refreshOutput();
    }catch(e){status('terminal-status',e.message,true);}
  };
  $('terminal-stdin').onkeydown=e=>{if(e.key==='Enter'){$('terminal-send').click();e.preventDefault();}};
  $('terminal-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('terminal-output').textContent);status('terminal-status','Output copied.');}catch(e){status('terminal-status','Select output and press Ctrl+C to copy.',true);}};
  $('file-filter').oninput=()=>{const q=$('file-filter').value.toLowerCase();for(const b of $('workspace-list').querySelectorAll('button'))b.hidden=!b.textContent.toLowerCase().includes(q);};
  $('terminal-stop').onclick=async()=>{try{await tool('force_terminate',{session_id:session});await refreshOutput();}catch(e){status('terminal-status',e.message,true);}};
  $('terminal-session').onchange=()=>{session=$('terminal-session').value;$('terminal-output').textContent=outputs.get(session)||'';clearTimeout(timer);void refreshOutput();};
  window.addEventListener('commander-snapshot',event=>{
    const snapshot=event.detail;
    const root=snapshot.config?.allowedRoots?.find(p=>p!=='*');
    if(root&&!$('workspace-path').value)$('workspace-path').value=root;
    if(root&&!$('terminal-cwd').value)$('terminal-cwd').value=root;
    const results=snapshot.pendingResults||[];$('outbox-panel').classList.toggle('hidden',!results.length);$('pending-results').replaceChildren();
    for(const result of results){const button=document.createElement('button');button.textContent=`Retry sending: ${result.tool}`;button.onclick=async()=>{try{await api.retryResult(result.id);}catch(e){button.textContent=e.message;}};$('pending-results').append(button);}
  });
  window.addEventListener('unhandledrejection',event=>{status('workspace-status',String(event.reason?.message||event.reason),true);});
  void loadSessions().catch(e=>status('terminal-status',e.message,true));
  void api.snapshot().then(detail=>window.dispatchEvent(new CustomEvent('commander-snapshot',{detail}))).catch(()=>{});
})();
