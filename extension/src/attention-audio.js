(() => {
  'use strict';
  if(globalThis.pcAttentionPlayAudio)return;
  let context=null;
  const active=new Set();
  async function play(options={}) {
    const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;
    if(!Audio)return {ok:false,error:'Web Audio is unavailable in this browser.'};
    if(!context||context.state==='closed')context=new Audio();
    let timer;
    try {
      if(context.state!=='running')await Promise.race([
        context.resume(),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Audio playback is blocked. Open Agent Monitor and test sound after allowing browser audio.')),1500);})
      ]);
    } finally {if(timer)clearTimeout(timer);}
    if(context.state!=='running')return {ok:false,error:'Browser audio is suspended. Use Test sound in Agent Monitor.'};
    const number=Number(options.volume);
    const volume=Number.isFinite(number)?Math.max(0,Math.min(1,number)):0.45;
    if(volume===0)return {ok:false,error:'Alert volume is set to zero.'};
    const tones=options.kind==='permission_required'?[659.25,830.61,987.77]:options.severity==='critical'?[783.99,587.33,783.99]:[659.25,880];
    const start=context.currentTime+0.015;
    tones.forEach((frequency,index)=>{
      const oscillator=context.createOscillator();
      const gain=context.createGain();
      const at=start+index*0.19;
      oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency,at);
      gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(volume*0.15,at+0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001,at+0.15);
      oscillator.connect(gain);gain.connect(context.destination);
      active.add(oscillator);
      oscillator.onended=()=>{active.delete(oscillator);oscillator.disconnect();gain.disconnect();};
      oscillator.start(at);oscillator.stop(at+0.16);
    });
    return {ok:true,started:true,backend:options.backend||'offscreen-web-audio',contextState:context.state,durationMs:tones.length*190};
  }
  globalThis.pcAttentionPlayAudio=play;
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message?.target!=='pc-attention-audio'||message?.type!=='PC_ATTENTION_AUDIO_PLAY')return false;
    if(sender?.id!==chrome.runtime.id){respond({ok:false,error:'Untrusted audio request.'});return false;}
    play(message).then(respond).catch((error)=>respond({ok:false,error:String(error?.message||error)}));
    return true;
  });
})();
