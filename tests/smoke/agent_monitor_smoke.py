"""Render the shipped monitor UI, exercise its controls, and keep labeled screenshots."""
from pathlib import Path
import json
import os
import time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
EXT = Path(os.environ.get("PROJECT_CONSTELLATION_BUILD", ROOT / "build" / "unpacked"))
if not (EXT / "agent-monitor.html").exists():
    EXT = ROOT / "extension"
OUT = ROOT / "logs" / "smoke"
OUT.mkdir(parents=True, exist_ok=True)
now = int(time.time() * 1000)
clients = [
    {"clientId": "chrome:work:one", "browser": "chrome", "label": "Chrome · Work", "connected": True},
    {"clientId": "firefox:research:two", "browser": "firefox", "label": "Firefox · Research", "connected": True},
    {"clientId": "edge:tests:three", "browser": "edge", "label": "Edge · Testing", "connected": True},
    {"clientId": "opera_gx:design:four", "browser": "opera_gx", "label": "Opera GX · Design", "connected": True},
]
definitions = [
    (0, "INTA · tool library redesign", "permission_required", "GitHub is waiting for Allow for this conversation.", "chatgpt.com/c/inta"),
    (1, "Athena · release research", "rate_limited", "Provider rate limit. Retry after the stated cooldown.", "claude.ai/chat/athena"),
    (2, "Constellation · browser bridge", "error", "The provider reported a network error while generating.", "chatgpt.com/c/bridge"),
    (3, "Sims4Foundry · CAS preview", "running", "Provider reports active generation.", "chatgpt.com/c/cas"),
    (0, "ModHunter · plugin compatibility", "running", "A tool is producing new output.", "chatgpt.com/c/modhunter"),
    (1, "Noxviola · tab workspace", "running", "Provider reports active generation.", "claude.ai/chat/noxviola"),
    (2, "GameSync · library import", "completed", "An assistant response finished.", "chatgpt.com/c/gamesync"),
    (3, "Enderloom · loader validation", "suspended", "The browser suspended this tab.", "chatgpt.com/c/enderloom"),
]
sessions = []
incidents = []
for i, (client, title, status, reason, url) in enumerate(definitions):
    owner = clients[client]
    row = dict(sessionId=owner["clientId"] + f":{i+1}", clientId=owner["clientId"], browser=owner["browser"],
               tabId=i+1, documentId=f"document-{i}", runId=f"run-{i}", title=title, status=status, reason=reason,
               url="https://" + url, connected=status != "suspended", updatedAt=now-(i+1)*17000,
               observedAt=now-(i+1)*17000)
    sessions.append(row)
    if i < 3:
        incidents.append(dict(incidentId=f"incident-{i}", sessionId=row["sessionId"], clientId=row["clientId"],
                              documentId=row["documentId"], runId=row["runId"], title=title, url=row["url"],
                              kind=status, reason=reason, firstSeenAt=now-(i+1)*70000,
                              updatedAt=now, acknowledgedAt=None, snoozedUntil=None, resolvedAt=None))
fixture = {"attention": {"sessions": [], "incidents": [], "settings": {"audioEnabled": True, "notificationsEnabled": True, "volume": .65, "completionEnabled": False, "reminderMinutes": 0},
                         "counts": {"open": 3, "sessions": 8}, "delivery": {}, "audioOwner": {"enabled": True}},
           "monitor": {"connected": True, "clientId": clients[0]["clientId"], "config": {"browser": "chrome", "label": "Chrome · Work"},
                       "snapshot": {"revision": 9, "clients": clients, "sessions": sessions, "incidents": incidents}}}
mock = """(() => {
const fixture = FIXTURE;
window.__monitorCalls=[]; window.__monitorEvents=[];
window.chrome={runtime:{id:'monitor-test',getManifest:()=>({version:'0.22.0'}),
onMessage:{addListener:fn=>__monitorEvents.push(fn)},sendMessage:async m=>{
  __monitorCalls.push(m);
  if(m.type==='PC_ATTENTION_GET')return {ok:true,attention:fixture.attention};
  if(m.type==='PC_MONITOR_GET')return {ok:true,monitor:fixture.monitor};
  if(m.type==='PC_ATTENTION_SETTINGS'||m.type==='PC_MONITOR_ALERT_SETTINGS'){Object.assign(fixture.attention.settings,m.settings);return {ok:true,attention:fixture.attention};}
  if(m.type==='PC_MONITOR_SETTINGS'){Object.assign(fixture.monitor.config,m.settings);return {ok:true,monitor:fixture.monitor};}
  if(m.type==='PC_MONITOR_ACK')fixture.monitor.snapshot.incidents.find(x=>x.incidentId===m.id).acknowledgedAt=Date.now();
  if(m.type==='PC_MONITOR_SNOOZE')fixture.monitor.snapshot.incidents.find(x=>x.incidentId===m.id).snoozedUntil=Date.now()+m.minutes*60000;
  if(m.type==='PC_ATTENTION_TEST'){fixture.attention.delivery.lastTest={ok:true,at:Date.now(),audio:{ok:true},notification:{ok:true}};return {ok:true,audio:{ok:true},notification:{ok:true}};}
  return {ok:true,monitor:fixture.monitor};
}},permissions:{request:async()=>true}};
})();""".replace("FIXTURE", json.dumps(fixture))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox"], executable_path=os.environ.get("PROJECT_CONSTELLATION_CHROMIUM") or None)
    page = browser.new_page(viewport={"width": 1512, "height": 1120}, device_scale_factor=1)
    errors = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.add_init_script(mock)
    page.goto((EXT / "agent-monitor.html").as_uri())
    page.wait_for_function("document.querySelector('#totalCount').textContent === '8'")
    assert page.locator("#attentionCount").inner_text() == "3"
    assert page.locator("#runningCount").inner_text() == "3"
    assert page.locator("#coverageCount").inner_text() == "4 / 4"
    assert page.locator("#sessionList .session").count() == 8
    page.evaluate("document.querySelector('#previewBanner').hidden=false")
    page.screenshot(path=str(OUT / "agent-monitor-desktop.png"), full_page=True)
    page.fill("#searchAgents", "noxviola")
    assert page.locator("#sessionList .session").count() == 1
    page.fill("#searchAgents", "")
    page.select_option("#browserFilter", "firefox")
    assert page.locator("#sessionList .session").count() == 2
    page.select_option("#browserFilter", "all")
    page.locator('.filter-tabs [data-filter="unavailable"]').click()
    assert page.locator("#sessionList .session").count() == 1
    assert page.locator("#sessionList .open-session").is_disabled()
    page.locator('.filter-tabs [data-filter="all"]').click()
    page.locator("#incidentList .incident").filter(has_text="INTA").get_by_role("button", name="Review permission").click()
    page.wait_for_function("__monitorCalls.some(m=>m.type==='PC_MONITOR_FOCUS')")
    assert page.evaluate("__monitorCalls.find(m=>m.type==='PC_MONITOR_FOCUS').sessionId") == sessions[0]["sessionId"]
    page.locator("#incidentList .incident").filter(has_text="INTA").get_by_role("button", name="Acknowledge").click()
    page.wait_for_function("document.querySelector('#incidentList').textContent.includes('Acknowledged')")
    page.locator("#incidentList .incident").filter(has_text="Athena").get_by_role("button", name="Snooze").click()
    page.wait_for_function("document.querySelector('#incidentList').textContent.includes('Snoozed until')")
    page.get_by_role("button", name="Test alert").click()
    page.wait_for_function("__monitorCalls.some(m=>m.type==='PC_ATTENTION_TEST')")
    page.select_option("#reminderMinutes", "15")
    page.wait_for_function("__monitorCalls.some(m=>m.type==='PC_MONITOR_ALERT_SETTINGS'&&m.settings.reminderMinutes===15)")
    page.locator("#quietHour").click()
    page.wait_for_function("!document.querySelector('#unmute').hidden")
    page.locator("#unmute").click()
    page.wait_for_function("document.querySelector('#unmute').hidden")
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.locator("#refreshMonitor").is_visible(), "Refresh remains available in a narrow window"
    assert page.locator("#refreshMonitor .ui-icon").is_visible(), "Compact Refresh must retain a visible icon"
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Mobile layout must not overflow horizontally"
    page.keyboard.press("/")
    assert page.locator("#searchAgents").evaluate("el => el === document.activeElement")
    page.locator("#toast").wait_for(state="hidden", timeout=7000)
    page.evaluate("document.activeElement?.blur(); window.scrollTo(0, 0)")
    page.screenshot(path=str(OUT / "agent-monitor-mobile.png"), full_page=True)
    assert not errors, errors
    print(json.dumps({"rendered": "built extension monitor", "viewports": [1512, 390], "sessions": 8, "incidents": 3,
                      "controls": ["search", "browser filter", "status filter", "cross-browser focus", "acknowledge", "snooze", "test alert", "reminders", "mute", "keyboard search"], "pageErrors": errors}))
    browser.close()
