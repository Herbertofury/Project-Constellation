(() => {
  'use strict';

  const VERSION = 1;
  const STOP = new Set(['the','and','for','with','from','this','that','chat','project','projects','help','make','into','your','have','what','how','can','use','using','new','fix','update','build','create','please','need','want','about','more','like','just','all','its','are','was','you','me','my','our','not','but','work','working','continue','continued','previous','latest']);

  function clean(value, max = 6000) { return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, max); }
  function tokens(value, max = 96) {
    const out=[]; const seen=new Set();
    for (const raw of clean(value).toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._+#-]{1,47}/gu) || []) {
      const token=raw.replace(/^[-_.]+|[-_.]+$/g,'');
      if (!token || token.length < 3 || STOP.has(token) || /^\d+$/.test(token) || seen.has(token)) continue;
      seen.add(token); out.push(token); if(out.length>=max)break;
    }
    return out;
  }
  function addWeights(map, value, weight, max = 96) { for (const token of tokens(value,max)) map.set(token, Math.max(Number(map.get(token)||0), Number(weight)||1)); }
  function chatVector(chat = {}) {
    const map=new Map();
    addWeights(map,chat.title,5,28);
    addWeights(map,(chat.tags||[]).join(' '),3.5,32);
    addWeights(map,chat.lastUserExcerpt,2.4,48);
    addWeights(map,chat.note,1.8,48);
    addWeights(map,chat.lastExcerpt,1.15,56);
    return map;
  }
  function projectProfiles(projects = [], assignedChats = []) {
    const profiles=new Map();
    for(const project of projects){
      if(!project?.id || project.deletedAt || project.sourceType!=='workspace' || project.archived)continue;
      const weights=new Map();
      addWeights(weights,project.name,7,24); addWeights(weights,project.description,3.2,48); addWeights(weights,project.notes,2,72);
      profiles.set(project.id,{id:project.id,name:clean(project.name,180)||'Project',groupId:project.groupId||'',weights,nameTokens:new Set(tokens(project.name,24)),chatCount:0,updatedAt:Number(project.updatedAt||0)});
    }
    for(const chat of assignedChats){
      const profile=profiles.get(chat?.workspaceProjectId); if(!profile)continue;
      profile.chatCount+=1;
      addWeights(profile.weights,chat.title,2.7,28); addWeights(profile.weights,(chat.tags||[]).join(' '),2.4,28); addWeights(profile.weights,chat.lastUserExcerpt,1.0,36); addWeights(profile.weights,chat.lastExcerpt,.55,36);
    }
    return profiles;
  }
  function scoreCandidate(chat = {}, profile = {}, prepared = null) {
    const vector=prepared?.vector||chatVector(chat); if(!vector.size)return null;
    const total=[...vector.values()].reduce((sum,v)=>sum+v,0)||1;
    let matchedWeight=0; const shared=[]; let nameHits=0;
    for(const [token,weight] of vector){
      if(profile.weights?.has(token)){matchedWeight+=weight;shared.push(token);}
      if(profile.nameTokens?.has(token))nameHits+=1;
    }
    const meaningful=[...new Set(shared)];
    const normalizedName=clean(profile.name,180).toLocaleLowerCase();
    const chatHay=prepared?.chatHay||clean(`${chat.title||''} ${chat.lastUserExcerpt||''} ${chat.note||''}`,3000).toLocaleLowerCase();
    const exactName=normalizedName.length>=4 && chatHay.includes(normalizedName);
    if(!exactName && meaningful.length<2)return null;
    const coverage=matchedWeight/total;
    const nameCoverage=profile.nameTokens?.size ? nameHits/profile.nameTokens.size : 0;
    const density=Math.min(1,meaningful.length/5);
    let score=coverage*.72 + nameCoverage*.2 + density*.18 + (exactName?.24:0);
    if(profile.chatCount===0 && !exactName)score*=.82;
    score=Math.max(0,Math.min(1,score));
    if(score<.48)return null;
    const confidence=score>=.84?'high':score>=.68?'medium':'review';
    return { projectId:profile.id,projectName:profile.name,score:Number(score.toFixed(4)),confidence,sharedTerms:meaningful.slice(0,6),exactName,projectChatCount:profile.chatCount };
  }
  function routeChat(chat = {}, profiles = new Map(), {limit=3} = {}) {
    if(!chat?.id || chat.workspaceProjectId || chat.projectRouteSuppressed)return [];
    const rows=[]; const prepared={vector:chatVector(chat),chatHay:clean(`${chat.title||''} ${chat.lastUserExcerpt||''} ${chat.note||''}`,3000).toLocaleLowerCase()};
    for(const profile of profiles.values()){const scored=scoreCandidate(chat,profile,prepared);if(scored)rows.push(scored);}
    rows.sort((a,b)=>b.score-a.score||Number(b.exactName)-Number(a.exactName)||a.projectName.localeCompare(b.projectName));
    return rows.slice(0,Math.max(1,Math.min(Number(limit)||3,5)));
  }
  function fingerprint(chat = {}, candidate = {}) {
    const value=`${VERSION}|${chat.id||''}|${clean(chat.title,300)}|${clean(chat.lastUserExcerpt||chat.lastExcerpt,1000)}|${(chat.tags||[]).join(',')}|${candidate.projectId||''}|${candidate.score||0}`;
    let hash=2166136261; for(const ch of value){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619);} return (hash>>>0).toString(16).padStart(8,'0');
  }
  function suggestions({projects=[],chats=[],limit=24,projectId=''}={}){
    const profiles=projectProfiles(projects,chats.filter((chat)=>chat.workspaceProjectId));
    const rows=[];
    for(const chat of chats){
      if(chat.workspaceProjectId||chat.organizedArchived||chat.projectRouteSuppressed)continue;
      for(const candidate of routeChat(chat,profiles,{limit:projectId?3:1})){
        if(projectId && candidate.projectId!==projectId)continue;
        const fp=fingerprint(chat,candidate);
        const dismissed=Array.isArray(chat.projectRouteDismissals)&&chat.projectRouteDismissals.some((row)=>row?.projectId===candidate.projectId&&row?.fingerprint===fp);
        if(dismissed)continue;
        rows.push({chatId:chat.id,chatTitle:clean(chat.title||'Untitled chat',220),chatUrl:chat.url||'',providerId:chat.providerId||'',updatedAt:Number(chat.updatedAt||0),candidate:{...candidate,fingerprint:fp}});
      }
    }
    rows.sort((a,b)=>b.candidate.score-a.candidate.score||b.updatedAt-a.updatedAt);
    return rows.slice(0,Math.max(1,Math.min(Number(limit)||24,120)));
  }

  globalThis.ProjectConstellationProjectRouterCore=Object.freeze({VERSION,tokens,chatVector,projectProfiles,scoreCandidate,routeChat,fingerprint,suggestions});
  if(typeof module!=='undefined'&&module.exports)module.exports=globalThis.ProjectConstellationProjectRouterCore;
})();
