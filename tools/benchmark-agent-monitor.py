"""Compare complete dashboard workloads in a real isolated Chromium renderer.

No rows are capped or culled. Cold rendering includes script evaluation, the
two structured-cloned status replies, all DOM construction and forced layout.
Update timings include the same complete status replies and forced layout.
Memory is measured after explicit GC through the isolated browser's CDP API;
it is JavaScript heap, not process RSS or a claim about the owner's browser.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import statistics
import subprocess
import time

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
NOW = 1_800_000_000_000


def fixture(size: int) -> dict:
    clients = [dict(clientId=f"{name}:work:session", browser=name,
                    label=f"{name} · Work", connected=True)
               for name in ["chrome", "firefox", "edge", "opera_gx"]]
    sessions, incidents = [], []
    for index in range(size):
        client = clients[index % len(clients)]
        row = dict(sessionId=f"{client['clientId']}:{index+1}",
                   clientId=client["clientId"], browser=client["browser"],
                   tabId=index+1, documentId=f"document-{index}", runId=f"run-{index}",
                   title=f"Project {index:05d} · full workload", status="error" if index % 2 == 0 else "running",
                   reason="Current provider evidence for the complete workload.",
                   url=f"https://chatgpt.com/c/benchmark-{index}", connected=True,
                   updatedAt=NOW-index*1000, observedAt=NOW-index*1000)
        sessions.append(row)
        if index % 2 == 0:
            incidents.append(dict(incidentId=f"incident-{index}", sessionId=row["sessionId"],
                                  clientId=row["clientId"], documentId=row["documentId"], runId=row["runId"],
                                  title=row["title"], url=row["url"], kind="error", reason=row["reason"],
                                  firstSeenAt=NOW-60_000-index*1000, updatedAt=NOW,
                                  acknowledgedAt=None, snoozedUntil=None, resolvedAt=None))
    return {"attention": {"sessions": [], "incidents": [], "settings": {}, "delivery": {},
                          "audioOwner": {"enabled": True}},
            "monitor": {"connected": True, "clientId": clients[0]["clientId"],
                        "config": {"browser": "chrome", "label": "Chrome · Work"},
                        "snapshot": {"revision": 1, "clients": clients, "sessions": sessions, "incidents": incidents}}}


def sources(ref: str | None) -> dict:
    result = {}
    for suffix in ["js", "html", "css"]:
        path = f"extension/agent-monitor.{suffix}"
        result[suffix] = subprocess.check_output(["git", "show", f"{ref}:{path}"], cwd=ROOT).decode() if ref else (ROOT/path).read_text()
    result["sha256"] = {suffix: hashlib.sha256(result[suffix].encode()).hexdigest() for suffix in ["js", "html", "css"]}
    html = re.sub(r'<script\b[^>]*src=[^>]*>\s*</script>', '', result["html"], flags=re.I)
    html = re.sub(r'<link\b[^>]*rel="stylesheet"[^>]*>', '', html, flags=re.I)
    result["document"] = html.replace('</head>', '<style>'+result['css']+'</style></head>')
    return result


INSTALL = """data => {
  Date.now=()=>1800000000000;
  window.__fixture=data;window.__handlers=[];
  window.chrome={runtime:{getManifest:()=>({version:'benchmark'}),onMessage:{addListener:fn=>__handlers.push(fn)},
    sendMessage:async message=>message.type==='PC_ATTENTION_GET'?{ok:true,attention:structuredClone(__fixture.attention)}:
      message.type==='PC_MONITOR_GET'?{ok:true,monitor:structuredClone(__fixture.monitor)}:{ok:true}},permissions:{request:async()=>true}};
}"""

MEASURE = """async ({source,mode,expectedSessions,expectedIncidents}) => {
  const originalSessions=[...document.querySelectorAll('#sessionList .session')];
  const originalIncidents=[...document.querySelectorAll('#incidentList .incident')];
  if(mode==='changed'){
    __fixture.monitor.snapshot.sessions.at(-1).title+=' · changed';
    __fixture.monitor.snapshot.incidents.at(-1).reason+=' A changed observation.';
    __fixture.monitor.snapshot.revision++;
  }
  const elapsed=await new Promise((resolve,reject)=>{
    const target=document.querySelector('#alertDelivery');
    const timeout=setTimeout(()=>{observer.disconnect();reject(new Error('Dashboard render did not finish'));},20000);
    const start=performance.now();
    const observer=new MutationObserver(()=>{
      observer.disconnect();clearTimeout(timeout);
      // Materialize layout for the complete document, not only the viewport.
      const height=document.documentElement.scrollHeight;
      resolve({ms:performance.now()-start,height});
    });
    observer.observe(target,{childList:true,subtree:true,characterData:true});
    if(mode==='cold')(0,eval)(source);
    else __handlers.forEach(fn=>fn({type:'PC_MONITOR_CHANGED'}));
  });
  const sessions=[...document.querySelectorAll('#sessionList .session')];
  const incidents=[...document.querySelectorAll('#incidentList .incident')];
  if(sessions.length!==expectedSessions||incidents.length!==expectedIncidents)throw new Error('Incomplete rendered workload: '+JSON.stringify({sessions:sessions.length,incidents:incidents.length}));
  const sessionSet=new Set(sessions),incidentSet=new Set(incidents);
  return {...elapsed,sessions:sessions.length,incidents:incidents.length,
    retainedSessions:originalSessions.filter(el=>sessionSet.has(el)).length,
    retainedIncidents:originalIncidents.filter(el=>incidentSet.has(el)).length};
}"""


def summary(values: list[float]) -> dict:
    ordered = sorted(values)
    return {"n": len(values), "p50": statistics.median(ordered),
            "p95": ordered[max(0, math.ceil(len(ordered)*.95)-1)], "min": ordered[0], "max": ordered[-1]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', default='4fe8980f8caad979eb42dd47d64fa33190d25a2b')
    parser.add_argument('--sizes', default='100,1000,2000')
    parser.add_argument('--samples', type=int, default=11)
    parser.add_argument('--output', default='logs/agent-monitor-benchmark.json')
    args = parser.parse_args()
    sizes = [int(value) for value in args.sizes.split(',')]
    if args.samples < 3 or not sizes or any(value < 2 for value in sizes):
        raise SystemExit('Use at least three samples and positive workloads with at least two sessions.')
    variants = {'baseline': sources(args.baseline), 'candidate': sources(None)}
    report = {"schema": "constellation-full-dashboard-benchmark-v1", "baselineCommit": args.baseline,
              "candidateHead": subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip(),
              "capturedSourceSha256": {name: source['sha256'] for name, source in variants.items()},
              "workload": "All sessions and one incident per two sessions. Cold eval/status replies/DOM/layout; complete unchanged and two-row changed refreshes. No caps/culling/pagination.",
              "memoryScope": "CDP JSHeapUsedSize after explicit collection, total for this page; not process RSS.",
              "timingUnit": "milliseconds", "samples": args.samples, "results": []}
    output = ROOT/args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=['--no-sandbox'], executable_path=os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None)
        report['browserVersion'] = browser.version
        for size in sizes:
            data = fixture(size)
            raw = {name: [] for name in variants}
            for sample in range(args.samples):
                # Alternate order to avoid assigning one variant consistently to
                # a warmer process or a later phase of host contention.
                order = ['baseline', 'candidate'] if sample % 2 == 0 else ['candidate', 'baseline']
                for name in order:
                    source = variants[name]
                    page = browser.new_page(viewport={"width": 1512, "height": 1120})
                    errors = []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.set_content(source['document'])
                    page.evaluate(INSTALL, data)
                    row = {}
                    for mode in ['cold', 'unchanged', 'changed']:
                        row[mode] = page.evaluate(MEASURE, dict(source=source['js'] if mode == 'cold' else '', mode=mode,
                                                               expectedSessions=size, expectedIncidents=len(data['monitor']['snapshot']['incidents'])))
                    cdp = page.context.new_cdp_session(page)
                    cdp.send('Performance.enable')
                    cdp.send('HeapProfiler.collectGarbage')
                    row['jsHeapUsedBytesAfterGc'] = next(item['value'] for item in cdp.send('Performance.getMetrics')['metrics'] if item['name'] == 'JSHeapUsedSize')
                    row['domCounters'] = cdp.send('Memory.getDOMCounters')
                    if errors:
                        raise RuntimeError(errors)
                    raw[name].append(row)
                    page.close()
            for name, records in raw.items():
                result = {"variant": name, "sessions": size, "incidents": len(data['monitor']['snapshot']['incidents']),
                          "timings": {mode: summary([item[mode]['ms'] for item in records]) for mode in ['cold', 'unchanged', 'changed']},
                          "jsHeapUsedBytesAfterGc": summary([item['jsHeapUsedBytesAfterGc'] for item in records]),
                          "allSamplesRenderedCompleteWorkload": True, "raw": records}
                report['results'].append(result)
                print(json.dumps({key: value for key, value in result.items() if key != 'raw'}), flush=True)
            # Preserve each completed equivalent workload if a later size is
            # interrupted. Incomplete groups never appear as completed results.
            report['elapsedSeconds'] = time.monotonic()-started
            report['complete'] = False
            output.write_text(json.dumps(report, indent=2)+'\n')
        browser.close()
    report['elapsedSeconds'] = time.monotonic()-started
    report['complete'] = True
    output.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({"report": str(output), "elapsedSeconds": report['elapsedSeconds']}), flush=True)


if __name__ == '__main__':
    main()
