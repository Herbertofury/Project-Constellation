'use strict';
const $ = id => document.getElementById(id);
let latest, controlsDirty = false;
const human = s => String(s || 'Unknown').replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
const send = message => chrome.runtime.sendMessage(message);
function render(state) {
  latest = state;
  const unresolved = Object.values(state.sessions).filter(s => !['RUNNING_OBSERVED','UI_COMPLETION_OBSERVED'].includes(s.status)).length;
  $('status').textContent = !state.config.enabled ? 'Recovery paused by you' : unresolved ? `${unresolved} recovery run${unresolved === 1 ? '' : 's'} still unresolved` : human(state.status);
  $('last').textContent = state.lastInspection ? 'Last inspection: ' + new Date(state.lastInspection).toLocaleString() : 'No inspection yet.';
  $('toggle').textContent = state.config.enabled ? 'Pause recovery' : 'Enable recovery';
  $('count').textContent = state.scannedKeys?.length || 0;
  $('resumed').textContent = Object.values(state.incidents).filter(i => ['RUNNING_OBSERVED','UI_COMPLETION_OBSERVED'].includes(i.status)).length;
  $('pending').textContent = Object.values(state.sessions).filter(s => !['RUNNING_OBSERVED','UI_COMPLETION_OBSERVED'].includes(s.status)).length;
  $('coverage').textContent = 'List coverage: ' + human(state.coverage) + '. UI progress is not proof of Google/GitHub/email delivery.';
  const cards = Object.entries(state.sessions);
  $('sessions').replaceChildren();
  if (!cards.length) {
    const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No active recovery session. Activity remains in local diagnostics.'; $('sessions').append(p);
  }
  for (const [id, s] of cards) {
    const card = document.createElement('div'); card.className = 'card';
    const title = document.createElement('strong'); title.textContent = s.title;
    const status = document.createElement('span'); status.className = 'state'; status.textContent = human(s.status);
    const br = document.createElement('br'), button = document.createElement('button'); button.textContent = 'Inspect this run'; button.className = 'secondary';
    button.addEventListener('click', async () => { try { await chrome.tabs.update(Number(id), {active:true}); } catch (e) { $('error').textContent = e.message; } });
    card.append(title, status, br, button); $('sessions').append(card);
  }
  if (!controlsDirty) {
    $('interval').value = state.config.intervalMinutes;
    $('discover').checked = state.config.discoverAttention;
    $('continue').checked = state.config.allowContinuation;
    $('titles').value = state.config.managedTitles.join('\n');
  }
  $('history').textContent = state.history.slice(-30).map(x => JSON.stringify(x)).join('\n');
}
async function refresh() { try { render(await send({type:'PCX_RECOVERY_STATE'})); } catch(e) { $('error').textContent = e.message; } }
$('check').onclick = async () => { $('check').disabled = true; try { render(await send({type:'PCX_RECOVERY_CHECK'})); } catch(e) { $('error').textContent=e.message; } finally { $('check').disabled=false; } };
$('toggle').onclick = async () => { await send({type:'PCX_RECOVERY_CONFIG',config:{enabled:!latest.config.enabled}}); await refresh(); };
$('open').onclick = () => chrome.tabs.create({url:'https://chatgpt.com/schedules'});
for (const id of ['interval','discover','continue','titles']) $(id).addEventListener('input', () => {controlsDirty=true;});
$('save').onclick = async () => {
  await send({type:'PCX_RECOVERY_CONFIG',config:{intervalMinutes:Number($('interval').value),discoverAttention:$('discover').checked,
    allowContinuation:$('continue').checked, managedTitles:$('titles').value.split('\n')}});
  controlsDirty=false; await refresh();
};
$('export').onclick = () => {
  const blob = new Blob([JSON.stringify(latest,null,2)+'\n'],{type:'application/json'});
  const url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url; a.download='constellation-task-recovery-diagnostics.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
};
chrome.storage.onChanged.addListener((changes,area) => { if(area==='local' && (changes[PCXTaskRecoveryCore.KEY] || changes[PCXTaskRecoveryCore.KEY+'.config'])) void refresh(); });
void refresh();
