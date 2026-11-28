import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
const source=fs.readFileSync(new URL('../extension/src/browser-monitor-sensor.js',import.meta.url),'utf8');
// A small independent DOM fixture supplies selectors/order/visibility. Production
// sensor code runs unchanged; no tests duplicate its status classification rules.
class Element {
  constructor(tag='div',attributes={},text=''){this.tagName=tag;this.attrs={...attributes};this.ownText=text;this.children=[];this.parentElement=null;this.style={};this.rect={width:100,height:20};this.clicked=0;this.focused=0;this.scrolled=0;}
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}return this;}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this);this.parentElement=null;}
  get textContent(){return this.ownText+this.children.map(x=>x.textContent).join(' ');}
  set textContent(value){this.ownText=value;this.children=[];}
  get disabled(){return 'disabled' in this.attrs;}
  getAttribute(key){return this.attrs[key]??null;}
  matches(selector){return selector.split(',').some(raw=>{const part=raw.trim(),tag=part.match(/^[a-z][\w-]*/i)?.[0];if(tag&&tag!==this.tagName)return false;for(const value of part.matchAll(/\.([\w-]+)/g)){if(!(this.attrs.class||'').split(' ').includes(value[1]))return false;}for(const [,key,op,value] of part.matchAll(/\[([\w-]+)(?:([*^]?=)"([^"]*)")?\]/g)){const actual=this.getAttribute(key);if(actual===null)return false;if(op==='='&&actual!==value)return false;if(op==='^='&&!actual.startsWith(value))return false;if(op==='*='&&!actual.includes(value))return false;}return true;});}
  querySelectorAll(selector){const found=[];for(const child of this.children){if(child.matches(selector))found.push(child);found.push(...child.querySelectorAll(selector));}return found;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){for(let item=this;item;item=item.parentElement)if(item.matches(selector))return item;return null;}
  contains(other){return this===other||this.children.some(x=>x.contains(other));}
  compareDocumentPosition(other){let root=this;while(root.parentElement)root=root.parentElement;const items=[];const visit=node=>{items.push(node);node.children.forEach(visit);};visit(root);return items.indexOf(other)>items.indexOf(this)?4:2;}
  checkVisibility(){for(let el=this;el;el=el.parentElement)if(el.style.display==='none'||el.style.visibility==='hidden'||Number(el.style.opacity??1)===0||'hidden'in el.attrs)return false;return true;}
  getBoundingClientRect(){return this.checkVisibility()?this.rect:{width:0,height:0};}
  scrollIntoView(){this.scrolled++;}focus(){this.focused++;}click(){this.clicked++;throw new Error('Sensor must never click.');}
}
const el=(...args)=>new Element(...args);
const html=el('html'),body=el('body'),main=el('main');html.append(body);body.append(main);
const oldUser=el('div',{'data-message-author-role':'user'},'Old request');
const oldAnswer=el('div',{'data-message-author-role':'assistant'},'Old answer');
const currentUser=el('div',{'data-message-author-role':'user'},'Current request');
main.append(oldUser,oldAnswer,currentUser);
const documentEvents=new Map(),windowEvents=new Map(),listeners=[],sent=[],timers=new Map();let time=10_000,id=0,mutationObserver,requests=0;
const document={body,documentElement:html,title:'Task one',querySelectorAll:selector=>html.querySelectorAll(selector),addEventListener:(name,fn)=>documentEvents.set(name,fn),removeEventListener:name=>documentEvents.delete(name)};
const window={addEventListener:(name,fn)=>windowEvents.set(name,fn),removeEventListener:name=>windowEvents.delete(name)};
const context=vm.createContext({document,window,location:{href:'https://chatgpt.com/c/one?token=private#view'},Node:{DOCUMENT_POSITION_FOLLOWING:4},crypto:{randomUUID},URL,Promise,console,
  Date:class extends Date{static now(){return time;}},getComputedStyle:node=>({display:'block',visibility:'visible',opacity:'1',...node.style}),
  MutationObserver:class{constructor(fn){this.callback=fn;mutationObserver=this;}observe(){}disconnect(){}},
  setTimeout:(fn,ms)=>{const key=++id;timers.set(key,{fn,at:time+ms});return key;},clearTimeout:key=>timers.delete(key),
  fetch:()=>{requests++;throw new Error('No provider requests.');},XMLHttpRequest:class{constructor(){requests++;throw new Error('No provider requests.');}},
  browser:{runtime:{sendMessage:async(message)=>{sent.push(structuredClone(message));return {ok:true};},onMessage:{addListener:fn=>listeners.push(fn),removeListener:fn=>listeners.splice(listeners.indexOf(fn),1)}}}});
vm.runInContext(source,context);
const last=()=>sent.at(-1).event;
const rescan=()=>listeners[0]({type:'PC_MONITOR_RESCAN'});
const mutate=()=>{mutationObserver.callback([{target:main}]);const pending=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];if(pending){time=pending[1].at;timers.delete(pending[0]);pending[1].fn();}};
assert.equal(last().status,'idle');assert.equal(last().url,'https://chatgpt.com/c/one');
const oldPermission=el('button',{},'Allow for this conversation');oldAnswer.append(oldPermission);
const code=el('pre').append(el('button',{},'Allow for this conversation'));body.append(code);await rescan();assert.equal(last().status,'idle','old turns and code snippets do not request permission');
const stop=el('button',{'data-testid':'stop-button'},'Stop');main.append(stop);mutate();assert.equal(last().status,'running');
const currentRun=last().runId;
const staleAlert=el('div',{role:'alert'},'Something went wrong');oldAnswer.append(staleAlert);await rescan();assert.equal(last().status,'running','historic inline alerts cannot override current work');
const card=el('section').append(el('h2',{},'Allow ChatGPT to use GitHub?'),el('button',{},'Allow'),el('button',{},'Deny'));main.append(card);mutate();assert.equal(last().status,'permission_required');assert.equal(last().runId,currentRun);
const loadedHistory=el('div',{'data-message-author-role':'user'},'Earlier loaded request');loadedHistory.parentElement=main;main.children.unshift(loadedHistory);
await rescan();assert.equal(last().runId,currentRun,'loading earlier history cannot restart the current run or invalidate its acknowledgment');
const hiddenFuture=el('div',{'data-message-author-role':'user',hidden:''},'Hidden hydration placeholder');main.append(hiddenFuture);
await rescan();assert.equal(last().runId,currentRun,'hidden hydration turns cannot replace the current user frontier');hiddenFuture.remove();
const allow=card.children[1];await listeners[0]({type:'PC_ATTENTION_REVEAL_PERMISSION'});assert.equal(allow.clicked,0);assert.equal(allow.focused,1);assert.equal(allow.scrolled,1);
card.style.display='none';mutate();assert.equal(last().status,'running','hidden consent is not live evidence');card.remove();
const warning=el('div',{role:'alert'},'This conversation has reached the maximum context limit. Start a new chat.');main.append(warning);mutate();assert.equal(last().status,'context_limit','conversation limit is not mistaken for rate limiting');
warning.textContent='Too many requests. Try again in 5 minutes.';mutate();assert.equal(last().status,'rate_limited');
warning.textContent='Network error: failed to generate';mutate();assert.equal(last().status,'error','explicit current failure outranks Stop');warning.remove();
await rescan();assert.equal(last().status,'running');stop.remove();mutate();assert.equal(last().status,'idle','an old response cannot complete the current request');
main.append(stop);mutate();
const answer=el('div',{'data-message-author-role':'assistant'},'A'.repeat(300));main.append(answer);mutate();assert.equal(last().status,'running');
const countBefore=sent.length;answer.ownText+='More real output';mutate();assert.equal(sent.length,countBefore+1,'output beyond the first120 characters emits metadata progress');
const stableCount=sent.length;mutate();assert.equal(sent.length,stableCount,'unchanged DOM state does not send a background heartbeat');
assert.ok(!JSON.stringify(sent).includes('More real output'),'response text never leaves the content world');
answer.append(el('button',{'data-testid':'copy-turn-action-button'},'Copy'));stop.remove();mutate();assert.equal(last().status,'completed');assert.equal(last().runId,currentRun);
const repeatedPrompt=el('div',{'data-message-author-role':'user'},'Current request');main.append(repeatedPrompt,stop);await rescan();
assert.equal(last().status,'running');assert.notEqual(last().runId,currentRun,'a later identical prompt remains a distinct generation');stop.remove();
context.location.href='https://chatgpt.com/c/two';windowEvents.get('popstate')();assert.equal(last().status,'idle','navigation clears the preceding chat generation history');
const priorCount=sent.length;await rescan();assert.equal(sent.length,priorCount+1,'user refresh produces a fresh explicit observation');
assert.equal(requests,0);assert.equal(oldPermission.clicked,0);assert.equal(allow.clicked,0);assert.equal(timers.size,0,'settled sensor has no repeating timer');
const originalSend=context.browser.runtime.sendMessage;
let failures=0;
context.browser.runtime.sendMessage=async(message)=>{sent.push(structuredClone(message));return ++failures===1?{ok:false,error:'Storage is briefly unavailable'}:{ok:true};};
let response=await rescan();assert.equal(response.ok,false,'a rescan reports rejected persistence instead of an optimistic ACK');
assert.equal(timers.size,1);assert.equal(context.__pcBrowserMonitorSensor.delivery.ok,false);
async function fireNext(){const next=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];assert.ok(next);time=next[1].at;timers.delete(next[0]);next[1].fn();await new Promise(setImmediate);}
await fireNext();assert.equal(failures,2);assert.equal(timers.size,0);assert.equal(context.__pcBrowserMonitorSensor.delivery.ok,true);
context.browser.runtime.sendMessage=async(message)=>{sent.push(structuredClone(message));failures++;throw new Error('Worker transport is unavailable');};
failures=0;await rescan();
for(const delay of [250,1000,3000]){assert.equal([...timers.values()][0].at,time+delay);await fireNext();}
assert.equal(failures,4);assert.equal(timers.size,0,'exhausted observation recovery stops rather than polling');
assert.equal(context.__pcBrowserMonitorSensor.delivery.attempts,4);
const beforeDuplicate=failures;mutate();await new Promise(setImmediate);assert.equal(failures,beforeDuplicate,'unchanged DOM noise cannot restart exhausted delivery');
// A delayed failure cannot create a retry after a newer accepted rescan.
let rejectOld;context.browser.runtime.sendMessage=()=>new Promise((_,reject)=>{rejectOld=reject;});
const oldPending=rescan();context.browser.runtime.sendMessage=originalSend;response=await rescan();assert.equal(response.ok,true);
rejectOld(new Error('An older send failed late'));await oldPending;
assert.equal(timers.size,0);assert.equal(context.__pcBrowserMonitorSensor.delivery.ok,true);
// A transport which never answers has the same finite retry path as a rejection.
let acceptLate;context.browser.runtime.sendMessage=()=>new Promise(resolve=>{acceptLate=resolve;});
const timedOut=rescan();assert.equal([...timers.values()][0].at,time+4000);
await fireNext();response=await timedOut;assert.equal(response.ok,false);assert.match(response.error,/four seconds/);
context.browser.runtime.sendMessage=originalSend;await fireNext();assert.equal(context.__pcBrowserMonitorSensor.delivery.ok,true);
acceptLate({ok:true});await new Promise(setImmediate);assert.equal(timers.size,0,'late acceptance cannot invalidate a newer retry or leave a timer behind');
context.browser.runtime.sendMessage=async()=>({ok:false,error:'Unavailable'});await rescan();assert.equal(timers.size,1);
windowEvents.get('pagehide')();assert.equal(timers.size,0,'a departing document cancels pending retries');
context.browser.runtime.sendMessage=originalSend;
const beforeHidden=sent.length;mutate();await new Promise(setImmediate);assert.equal(sent.length,beforeHidden);
assert.equal((await rescan()).ok,false);assert.equal(timers.size,0,'bfcache-hidden documents cannot resume publishing from mutations or explicit rescans');
await windowEvents.get('pageshow')();assert.equal(sent.length,beforeHidden+1,'pageshow resumes the same sensor with fresh evidence');
assert.equal(listeners.length,1);
context.browser.runtime.sendMessage=()=>new Promise(()=>{});const abandoned=rescan();assert.equal(timers.size,1);
windowEvents.get('pagehide')();assert.equal((await abandoned).ok,false);assert.equal(timers.size,0,'pagehide settles pending requests and cancels their response deadlines');
context.browser.runtime.sendMessage=originalSend;await windowEvents.get('pageshow')();
context.__pcBrowserMonitorSensor.dispose();assert.equal(listeners.length,0);assert.equal(context.__pcBrowserMonitorSensor,undefined);
vm.runInContext(source,context);await new Promise(setImmediate);assert.equal(listeners.length,1,'a disposed same-version sensor can be reinjected');
context.__pcBrowserMonitorSensor.dispose();assert.equal(listeners.length,0);assert.equal(timers.size,0);
document.body=null;vm.runInContext(source,context);assert.ok(documentEvents.has('DOMContentLoaded'));
const lateStart=documentEvents.get('DOMContentLoaded'),lastObserver=mutationObserver;
context.__pcBrowserMonitorSensor.dispose();document.body=body;lateStart();
assert.equal(mutationObserver,lastObserver,'a disposed pre-DOM sensor cannot attach a late observer');assert.equal(documentEvents.has('DOMContentLoaded'),false);
assert.equal(requests,0);
console.log('monitor-sensor.test.mjs: PASS (permission evidence, stable frontier, history/quotes, hidden state, failures, progress, completion, SPA, truthful rescan, bounded delivery and timeout recovery, bfcache lifecycle, reinjection, no network/clicks)');
