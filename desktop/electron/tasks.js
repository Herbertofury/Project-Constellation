'use strict';
(()=>{
  const api=window.commanderShell,$=id=>document.getElementById(id);if(!api||!$('task-list'))return;
  let signature='',refreshing=null,timer=null;
  const message=(text,error=false)=>{$('task-message').textContent=text;$('task-message').className='small '+(error?'bad':'muted');};
  async function tool(name,args){const r=await api.runTool(name,args);if(r?.ok===false)throw new Error(r.error||'Task action failed');return r.result??r;}
  async function refresh(){if(refreshing)return refreshing;refreshing=api.snapshot().then(s=>render(s.tasks||[])).catch(e=>message(e.message,true)).finally(()=>refreshing=null);return refreshing;}
  function button(label,action){const b=document.createElement('button');b.className='ghost';b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await action();await refresh();}catch(e){message(e.message,true);}finally{b.disabled=false;}};return b;}
  function render(tasks){
    clearTimeout(timer);if(tasks.some(t=>['running','waiting'].includes(t.status))&&!document.hidden)timer=setTimeout(refresh,1000);
    const next=JSON.stringify(tasks);if(next===signature)return;signature=next;$('task-list').replaceChildren();
    if(!tasks.length){const empty=document.createElement('p');empty.className='small muted';empty.textContent='No saved tasks yet. Ask ChatGPT to run a multi-step task, or save a terminal command.';$('task-list').append(empty);return;}
    for(const t of tasks){
      const card=document.createElement('article');card.className='task-card';card.dataset.taskId=t.id;const header=document.createElement('header'),name=document.createElement('strong'),state=document.createElement('span');name.textContent=t.title;state.textContent=`${t.status} / ${t.completed} of ${t.total}`;state.className='small task-state';header.append(name,state);
      const progress=document.createElement('progress');progress.value=t.completed;progress.max=t.total;progress.setAttribute('aria-label','Completed task steps');card.append(header,progress);
      if(t.error){const error=document.createElement('p');error.className='small';error.textContent=t.error;card.append(error);}
      const actions=document.createElement('div');actions.className='button-grid';
      actions.append(button('Step results',async()=>{const detail=await tool('get_task',{task_id:t.id});const old=card.querySelector('.task-details');old?.remove();const details=document.createElement('div');details.className='task-details';for(const s of detail.steps){const d=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent=`${s.id} - ${s.tool}: ${s.status}`;pre.textContent=JSON.stringify(s.result??{error:s.error||'Not executed'},null,2);d.append(summary,pre);details.append(d);}card.append(details);}));
      if(['running','waiting','paused'].includes(t.status))actions.append(button('Cancel',()=>tool('cancel_task',{task_id:t.id})));
      if(['failed','paused','cancelled'].includes(t.status))actions.append(button('Resume',async()=>{
        if(t.status!=='paused'&&!confirm('Completed steps will not repeat. A failed step may already have changed something. Inspect its results before authorizing a retry. Continue?'))return;
        await tool('resume_task',{task_id:t.id,retry_failed:t.status!=='paused'});
      }));
      if(t.status==='interrupted'){
        actions.append(button('I verified the step completed',async()=>{if(confirm('Only confirm after checking the interrupted operation completed. Project Constellation will skip it, not execute it again.'))await tool('resume_task',{task_id:t.id,resolve_uncertain:'accept-completed'});}));
        actions.append(button('Authorize interrupted-step retry',async()=>{if(confirm('The interrupted operation might already have run. Retrying may duplicate its effects. Have you inspected it and want to retry?'))await tool('resume_task',{task_id:t.id,resolve_uncertain:'retry',retry_failed:true});}));
      }
      card.append(actions);$('task-list').append(card);
    }
  }
  $('tasks-refresh').onclick=refresh;
  $('task-example').onclick=()=>{const root=$('terminal-cwd').value||$('workspace-path').value;$('task-title').value='Inspect workspace';$('task-plan').value=JSON.stringify([{id:'folder',tool:'get_file_info',args:{path:root}},{id:'files',tool:'list_directory',args:{path:root,depth:1}},{id:'system',tool:'get_system_info',args:{}}],null,2);};
  $('task-run').onclick=async()=>{const b=$('task-run');b.disabled=true;try{const steps=JSON.parse($('task-plan').value);const t=await tool('run_task',{title:$('task-title').value,steps});message(`Saved ${t.id}. Progress and results appear above.`);await refresh();}catch(e){message(e.message,true);}finally{b.disabled=false;}};
  $('terminal-task').onclick=async()=>{try{const command=$('terminal-command').value,cwd=$('terminal-cwd').value;if(!command.trim())throw new Error('Enter a command first');await tool('run_task',{title:command,steps:[{id:'command',tool:'start_process',args:{command,cwd},wait_for_exit:true}]});document.querySelector('.rail-button[data-view="activity"]').click();await refresh();}catch(e){message(e.message,true);$('terminal-status').textContent=e.message;}};
  window.addEventListener('commander-snapshot',e=>render(e.detail.tasks||[]));
  api.onEvent(e=>{if(e.type==='task-progress')void refresh();});document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();else clearTimeout(timer);});void refresh();
})();
