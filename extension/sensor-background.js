// Firefox's sensor uses a background document, unlike Chromium's service worker.
import './src/sensor-api.js';
import './src/provider-core.js';
import './src/state-event-bus-core.js';
import './src/attention-background.js';
import './src/native-monitor-bridge.js';

const api=globalThis.chrome;
api.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=='PC_SENSOR_OBSERVE')return false;
  if(sender.id!==api.runtime.id||!Number.isInteger(sender.tab?.id)||sender.frameId!==0)return false;
  const provider=globalThis.ProjectConstellationProviders.detectProvider(sender.tab.url);
  if(!provider)return false;
  const event={...message.event,tabId:sender.tab.id,url:sender.tab.url,providerId:provider.id,browser:'firefox',sourceId:'local'};
  globalThis.pcAttentionObserve(event).then(respond).catch(error=>respond({ok:false,error:String(error.message)}));return true;
});
api.action.onClicked.addListener(()=>api.tabs.create({url:api.runtime.getURL('agent-monitor.html')}));
